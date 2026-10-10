use rustler::{NifResult, Binary, ResourceArc, LocalPid, Env, OwnedEnv, Encoder};
use libloading::{Library, Symbol};
use std::sync::mpsc::{channel, Sender};
use std::thread;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::{Path};
use semver::{Version, VersionReq};
use flate2::read::GzDecoder;
use tar::Archive;

use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;
use oxc_codegen::CodeGenerator;
use oxc_semantic::SemanticBuilder;
use oxc_resolver::{ResolveOptions, Resolver};
use oxc_transformer::{Transformer, TransformOptions, Module as OxcModule};

use boa_engine::{Context, Source, JsValue, NativeFunction, JsString, JsArgs};
use boa_engine::object::ObjectInitializer;
use boa_engine::property::Attribute;

// --- N-API Compatibility Layer ---
pub type napi_env = *mut Context;
pub type napi_value = *mut JsValue;
pub type napi_status = i32;

pub const NAPI_OK: napi_status = 0;
pub const NAPI_INVALID_ARG: napi_status = 1;

#[no_mangle]
pub unsafe extern "C" fn napi_get_undefined(_env: napi_env, result: *mut napi_value) -> napi_status {
    let val = Box::into_raw(Box::new(JsValue::undefined()));
    *result = val;
    NAPI_OK
}

#[no_mangle]
pub unsafe extern "C" fn napi_get_null(_env: napi_env, result: *mut napi_value) -> napi_status {
    let val = Box::into_raw(Box::new(JsValue::null()));
    *result = val;
    NAPI_OK
}

#[no_mangle]
pub unsafe extern "C" fn napi_get_global(env: napi_env, result: *mut napi_value) -> napi_status {
    let ctx = &mut *env;
    let global = ctx.global_object();
    let val = Box::into_raw(Box::new(JsValue::from(global)));
    *result = val;
    NAPI_OK
}

#[no_mangle]
pub unsafe extern "C" fn napi_create_string_utf8(
    _env: napi_env,
    str: *const u8,
    length: usize,
    result: *mut napi_value
) -> napi_status {
    let s = std::slice::from_raw_parts(str, length);
    let js_str = String::from_utf8_lossy(s).to_string();
    let val = Box::into_raw(Box::new(JsValue::from(JsString::from(js_str))));
    *result = val;
    NAPI_OK
}

#[no_mangle]
pub unsafe extern "C" fn napi_create_function(
    env: napi_env,
    utf8name: *const u8,
    length: usize,
    _cb: unsafe extern "C" fn(napi_env, *mut napi_value) -> napi_value,
    _data: *mut std::ffi::c_void,
    result: *mut napi_value
) -> napi_status {
    let ctx = &mut *env;
    let name = if utf8name.is_null() { "anonymous".to_string() } else {
        String::from_utf8_lossy(std::slice::from_raw_parts(utf8name, length)).to_string()
    };
    let native_fn = NativeFunction::from_fn_ptr(move |_this, _args, _ctx| Ok(JsValue::undefined()));
    let obj = ObjectInitializer::new(ctx).function(native_fn, JsString::from(name), 0).build();
    let val = Box::into_raw(Box::new(JsValue::from(obj)));
    *result = val;
    NAPI_OK
}

#[no_mangle]
pub unsafe extern "C" fn napi_set_named_property(
    env: napi_env,
    object: napi_value,
    utf8name: *const u8,
    value: napi_value
) -> napi_status {
    let ctx = &mut *env;
    let obj_val = &*object;
    let val = &*value;
    let name = std::ffi::CStr::from_ptr(utf8name as *const i8).to_string_lossy().into_owned();
    if let Some(obj) = obj_val.as_object() {
        let _ = obj.set(JsString::from(name), val.clone(), false, ctx);
    }
    NAPI_OK
}

// Le runtime JS doit vivre sur son propre thread car Boa n'est pas Send/Sync (à cause du GC)
pub struct Runtime {
    tx: Sender<Box<dyn FnOnce(&mut Context) + Send>>,
}

fn on_load(env: rustler::Env, _info: rustler::Term) -> bool {
    let _ = rustler::resource!(Runtime, env);
    true
}

#[derive(Debug, Deserialize, Serialize, rustler::NifStruct)]
#[module = "BunNext.Package"]
pub struct Package {
    pub name: String, pub version: String,
    #[serde(default)] pub dependencies: HashMap<String, String>,
    #[serde(rename = "devDependencies", default)] pub dev_dependencies: HashMap<String, String>,
}

#[derive(Debug, Deserialize, Serialize, rustler::NifStruct)]
#[module = "BunNext.Module"]
pub struct Module { pub path: String, pub source: String }

#[rustler::nif]
fn parse_package_json(path: String) -> NifResult<Package> {
    let content = fs::read_to_string(path).map_err(|e| rustler::Error::Term(Box::new(e.to_string())))?;
    let package: Package = serde_json::from_str(&content).map_err(|e| rustler::Error::Term(Box::new(e.to_string())))?;
    Ok(package)
}

#[rustler::nif]
fn save_to_cache(name: String, version: String, data: Binary) -> NifResult<String> {
    let cache_dir = Path::new(".bun_cache");
    fs::create_dir_all(cache_dir).map_err(|e| rustler::Error::Term(Box::new(e.to_string())))?;
    let file_path = cache_dir.join(format!("{}-{}.tgz", name.replace("/", "_"), version));
    fs::write(&file_path, data.as_slice()).map_err(|e| rustler::Error::Term(Box::new(e.to_string())))?;
    Ok(file_path.to_str().unwrap().to_string())
}

#[rustler::nif]
fn resolve_deps(root_deps: HashMap<String, String>, registry: HashMap<String, HashMap<String, HashMap<String, String>>>) -> NifResult<HashMap<String, String>> {
    let mut solution = HashMap::new();
    let mut to_resolve: Vec<(String, String)> = root_deps.into_iter().collect();
    while let Some((pkg_name, req_str)) = to_resolve.pop() {
        if solution.contains_key(&pkg_name) { continue; }
        let versions = registry.get(&pkg_name).ok_or(rustler::Error::Term(Box::new(format!("Paquet inconnu : {}", pkg_name))))?;
        let mut best_version: Option<Version> = None;
        let clean_req_str = req_str.split("||").next().unwrap_or(&req_str).trim();
        let req = VersionReq::parse(clean_req_str).map_err(|e| rustler::Error::Term(Box::new(format!("Erreur semver pour {}@{}: {}", pkg_name, clean_req_str, e.to_string()))))?;
        for v_str in versions.keys() {
            if let Ok(v) = Version::parse(v_str) {
                if req.matches(&v) { if best_version.as_ref().map_or(true, |best| v > *best) { best_version = Some(v); } }
            }
        }
        if let Some(best_v) = best_version {
            let best_v_str = best_v.to_string();
            solution.insert(pkg_name.clone(), best_v_str.clone());
            if let Some(deps) = versions.get(&best_v_str) {
                for (dep_name, dep_req) in deps { to_resolve.push((dep_name.clone(), dep_req.clone())); }
            }
        } else { return Err(rustler::Error::Term(Box::new(format!("Aucune version compatible pour {}@{}", pkg_name, req_str)))); }
    }
    Ok(solution)
}

#[rustler::nif]
fn transpile_ts(code: String) -> NifResult<String> {
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, &code, SourceType::default().with_typescript(true)).parse();
    if !ret.errors.is_empty() { return Err(rustler::Error::Term(Box::new(format!("Erreur de parsing : {:?}", ret.errors[0])))); }
    let mut program = ret.program;
    let semantic_ret = SemanticBuilder::new().build(&program);
    let (symbols, scopes) = semantic_ret.semantic.into_symbol_table_and_scope_tree();
    Transformer::new(&allocator, Path::new("test.ts"), &TransformOptions::default()).build_with_symbols_and_scopes(symbols, scopes, &mut program);
    Ok(CodeGenerator::new().build(&program).code)
}

#[rustler::nif]
fn extract_tgz(tgz_path: String, dest_path: String) -> NifResult<String> {
    let tar_gz = fs::File::open(&tgz_path).map_err(|e| rustler::Error::Term(Box::new(e.to_string())))?;
    Archive::new(GzDecoder::new(tar_gz)).unpack(&dest_path).map_err(|e| rustler::Error::Term(Box::new(e.to_string())))?;
    Ok(dest_path)
}

#[rustler::nif]
fn bundle_simple(entry_path: String) -> NifResult<Vec<Module>> {
    let mut modules = Vec::new();
    let mut visited = HashSet::new();
    let mut queue = VecDeque::new();
    let abs_entry = fs::canonicalize(&entry_path).map_err(|e| rustler::Error::Term(Box::new(e.to_string())))?;
    let root_path = fs::canonicalize(".").unwrap();
    queue.push_back(abs_entry);
    let resolver = Resolver::new(ResolveOptions { builtin_modules: true, extensions: vec![".js".to_string()], ..ResolveOptions::default() });
    
    while let Some(current_path) = queue.pop_front() {
        let rel_path = current_path.strip_prefix(&root_path).unwrap_or(&current_path);
        let path_str = rel_path.to_str().unwrap().replace("\\", "/");
        
        let mut final_id = path_str.clone();
        if path_str.contains("lib/node_compat/") {
            let parts: Vec<&str> = path_str.split("lib/node_compat/").collect();
            if parts.len() > 1 {
                let name = parts[1].strip_suffix(".js").unwrap_or(parts[1]);
                final_id = format!("node:{}", name);
            }
        }

        if visited.contains(&final_id) { continue; }
        visited.insert(final_id.clone());

        let source_text = fs::read_to_string(&current_path).map_err(|e| rustler::Error::Term(Box::new(format!("{}: {}", path_str, e))))?;
        
        let re = regex::Regex::new(r#"(?:import|from|require)\s*\(?\s*['"]([^'"]+)['"]"#).unwrap();
        for cap in re.captures_iter(&source_text) {
            let req_name = &cap[1];
            
            // Résolution spéciale pour les modules internes de Node.js (commencent par "internal/")
            if req_name.starts_with("internal/") {
                let mut resolved_internal = None;
                
                // 0. Essai de trouver dans notre dossier de compatibilité custom (lib/internal/...)
                let custom_candidate = Path::new("lib").join(req_name).with_extension("js");
                if custom_candidate.exists() {
                    resolved_internal = Some(custom_candidate);
                }
                
                // 1. Essai de trouver un parent "lib" dans le chemin actuel
                if resolved_internal.is_none() {
                    let mut p = current_path.parent();
                    while let Some(parent_dir) = p {
                        if parent_dir.ends_with("lib") {
                            let path_candidate = parent_dir.join(req_name).with_extension("js");
                            if path_candidate.exists() {
                                resolved_internal = Some(path_candidate);
                                break;
                            }
                        }
                        p = parent_dir.parent();
                    }
                }
                
                // 2. Si non trouvé, on cherche sous node_source/node-26.0.0/lib/ et node_source/node-20.12.2/lib/
                if resolved_internal.is_none() {
                    for version in &["node-26.0.0", "node-20.12.2"] {
                        let path_candidate = Path::new("node_source")
                            .join(version)
                            .join("lib")
                            .join(req_name)
                            .with_extension("js");
                        if path_candidate.exists() {
                            resolved_internal = Some(path_candidate);
                            break;
                        }
                    }
                }
                
                if let Some(path) = resolved_internal {
                    if let Ok(canon) = fs::canonicalize(path) {
                        queue.push_back(canon);
                        continue;
                    }
                }
            }

            let builtin_name = req_name.strip_prefix("node:").unwrap_or(req_name);
            let compat_path = Path::new("lib/node_compat").join(format!("{}.js", builtin_name));
            if compat_path.exists() {
                queue.push_back(fs::canonicalize(compat_path).unwrap());
                continue;
            }

            let is_allowed_builtin = !builtin_name.contains("/") || builtin_name == "fs/promises" || builtin_name == "readline/promises";
            if is_allowed_builtin {
                // Si non trouvé dans lib/node_compat, on cherche dans les sources officielles de Node.js
                let mut resolved_official = None;
                for version in &["node-26.0.0", "node-20.12.2"] {
                    let path_candidate = Path::new("node_source")
                        .join(version)
                        .join("lib")
                        .join(format!("{}.js", builtin_name));
                    if path_candidate.exists() {
                        resolved_official = Some(path_candidate);
                        break;
                    }
                }
                if let Some(path) = resolved_official {
                    if let Ok(canon) = fs::canonicalize(path) {
                        queue.push_back(canon);
                        continue;
                    }
                }
            }
            if let Ok(resolved) = resolver.resolve(current_path.parent().unwrap(), req_name) {
                queue.push_back(resolved.into_path_buf());
            }
        }

        let allocator = Allocator::default();
        let ret = Parser::new(&allocator, &source_text, SourceType::from_path(&current_path).unwrap()).parse();
        if !ret.errors.is_empty() { return Err(rustler::Error::Term(Box::new(format!("{}: {:?}", path_str, ret.errors[0])))); }
        let mut program = ret.program;
        let semantic_ret = SemanticBuilder::new().build(&program);
        let (symbols, scopes) = semantic_ret.semantic.into_symbol_table_and_scope_tree();
        let mut options = TransformOptions::default();
        options.env = oxc_transformer::EnvOptions::from_target("es2022").unwrap();
        options.env.module = OxcModule::CommonJS;
        Transformer::new(&allocator, &current_path, &options).build_with_symbols_and_scopes(symbols, scopes, &mut program);

        // Optimisation AST (Minification AOT)
        use oxc_minifier::{Minifier, MinifierOptions};
        Minifier::new(MinifierOptions::default()).build(&allocator, &mut program);

        modules.push(Module { path: final_id, source: CodeGenerator::new().build(&program).code });
    }
    Ok(modules)
}

fn setup_context(context: &mut Context, pid: LocalPid) {
    let rust_log = NativeFunction::from_fn_ptr(|_, args, ctx| { 
        println!("{}", args.iter().map(|a| a.to_string(ctx).unwrap().to_std_string_escaped()).collect::<Vec<_>>().join(" ")); 
        Ok(JsValue::undefined()) 
    });
    let log_wrapper = ObjectInitializer::new(context).function(rust_log, JsString::from("log"), 1).build();
    let _ = context.register_global_property(JsString::from("__rust_log"), log_wrapper, Attribute::all());
    
    let rust_read = NativeFunction::from_fn_ptr(|_, args, ctx| {
        let path = args.get_or_undefined(0).to_string(ctx).unwrap().to_std_string_escaped();
        fs::read_to_string(&path).map(|c| JsValue::from(JsString::from(c))).map_err(|e| boa_engine::JsError::from_opaque(JsValue::from(JsString::from(e.to_string()))))
    });
    let rust_write = NativeFunction::from_fn_ptr(|_, args, ctx| {
        let path = args.get_or_undefined(0).to_string(ctx).unwrap().to_std_string_escaped();
        let content = args.get_or_undefined(1).to_string(ctx).unwrap().to_std_string_escaped();
        fs::write(&path, content).map(|_| JsValue::undefined()).map_err(|e| boa_engine::JsError::from_opaque(JsValue::from(JsString::from(e.to_string()))))
    });
    let rust_mkdir = NativeFunction::from_fn_ptr(|_, args, ctx| {
        let path = args.get_or_undefined(0).to_string(ctx).unwrap().to_std_string_escaped();
        fs::create_dir_all(&path).map(|_| JsValue::undefined()).map_err(|e| boa_engine::JsError::from_opaque(JsValue::from(JsString::from(e.to_string()))))
    });
    let rust_rm = NativeFunction::from_fn_ptr(|_, args, ctx| {
        let path = args.get_or_undefined(0).to_string(ctx).unwrap().to_std_string_escaped();
        fs::remove_file(&path).map(|_| JsValue::undefined()).map_err(|e| boa_engine::JsError::from_opaque(JsValue::from(JsString::from(e.to_string()))))
    });
    let rust_exists = NativeFunction::from_fn_ptr(|_, args, ctx| {
        let path = args.get_or_undefined(0).to_string(ctx).unwrap().to_std_string_escaped();
        Ok(JsValue::from(Path::new(&path).exists()))
    });
    let rust_stat = NativeFunction::from_fn_ptr(|_, args, ctx| {
        let path = args.get_or_undefined(0).to_string(ctx).unwrap().to_std_string_escaped();
        match fs::metadata(&path) {
            Ok(meta) => {
                let size = meta.len() as f64;
                let is_dir = meta.is_dir();
                let is_file = meta.is_file();
                
                let obj = boa_engine::object::ObjectInitializer::new(ctx)
                    .property(JsString::from("size"), size, Attribute::all())
                    .property(JsString::from("is_directory"), is_dir, Attribute::all())
                    .property(JsString::from("is_file"), is_file, Attribute::all())
                    .build();
                Ok(JsValue::from(obj))
            }
            Err(e) => Err(boa_engine::JsError::from_opaque(JsValue::from(JsString::from(e.to_string()))))
        }
    });
    let rust_readdir = NativeFunction::from_fn_ptr(|_, args, ctx| {
        let path = args.get_or_undefined(0).to_string(ctx).unwrap().to_std_string_escaped();
        match fs::read_dir(&path) {
            Ok(entries) => {
                let mut list = Vec::new();
                for entry in entries {
                    if let Ok(e) = entry {
                        if let Some(name) = e.file_name().to_str() {
                            list.push(JsValue::from(JsString::from(name)));
                        }
                    }
                }
                use boa_engine::object::builtins::JsArray;
                let js_arr = JsArray::from_iter(list, ctx).unwrap();
                Ok(JsValue::from(js_arr))
            }
            Err(e) => Err(boa_engine::JsError::from_opaque(JsValue::from(JsString::from(e.to_string()))))
        }
    });
    let rust_rmdir = NativeFunction::from_fn_ptr(|_, args, ctx| {
        let path = args.get_or_undefined(0).to_string(ctx).unwrap().to_std_string_escaped();
        fs::remove_dir(&path).map(|_| JsValue::undefined()).map_err(|e| boa_engine::JsError::from_opaque(JsValue::from(JsString::from(e.to_string()))))
    });
    let rust_rmdir_recursive = NativeFunction::from_fn_ptr(|_, args, ctx| {
        let path = args.get_or_undefined(0).to_string(ctx).unwrap().to_std_string_escaped();
        fs::remove_dir_all(&path).map(|_| JsValue::undefined()).map_err(|e| boa_engine::JsError::from_opaque(JsValue::from(JsString::from(e.to_string()))))
    });

    let fs_native = ObjectInitializer::new(context)
        .function(rust_read, JsString::from("read"), 1)
        .function(rust_write, JsString::from("write"), 2)
        .function(rust_mkdir, JsString::from("mkdir"), 1)
        .function(rust_rm, JsString::from("rm"), 1)
        .function(rust_exists, JsString::from("exists"), 1)
        .function(rust_stat, JsString::from("stat"), 1)
        .function(rust_readdir, JsString::from("readdir"), 1)
        .function(rust_rmdir, JsString::from("rmdir"), 1)
        .function(rust_rmdir_recursive, JsString::from("rmdirRecursive"), 1)
        .build();
    let _ = context.register_global_property(JsString::from("__rust_fs"), fs_native, Attribute::all());

    let rust_os_hostname = NativeFunction::from_fn_ptr(|_, _, _| Ok(JsValue::from(JsString::from(sys_info::hostname().unwrap_or("localhost".to_string())))));
    let rust_os_freemem = NativeFunction::from_fn_ptr(|_, _, _| Ok(JsValue::from(sys_info::mem_info().map(|m| m.free).unwrap_or(0) as f64)));
    let rust_os_totalmem = NativeFunction::from_fn_ptr(|_, _, _| Ok(JsValue::from(sys_info::mem_info().map(|m| m.total).unwrap_or(0) as f64)));
    let os_native = ObjectInitializer::new(context).function(rust_os_hostname, JsString::from("hostname"), 0).function(rust_os_freemem, JsString::from("freemem"), 0).function(rust_os_totalmem, JsString::from("totalmem"), 0).build();
    let _ = context.register_global_property(JsString::from("__rust_os"), os_native, Attribute::all());

    let rust_crypto_hash = NativeFunction::from_fn_ptr(|_, args, ctx| {
        let algo = args.get_or_undefined(0).to_string(ctx).unwrap().to_std_string_escaped();
        let data = args.get_or_undefined(1).to_string(ctx).unwrap().to_std_string_escaped();
        use ring::digest;
        let actual_algo = match algo.as_str() { "sha256" => &digest::SHA256, "sha512" => &digest::SHA512, _ => &digest::SHA256 };
        let hash = digest::digest(actual_algo, data.as_bytes());
        Ok(JsValue::from(JsString::from(hex::encode(hash.as_ref()))))
    });
    let rust_crypto_random = NativeFunction::from_fn_ptr(|_, args, ctx| {
        let size = args.get_or_undefined(0).to_number(ctx).unwrap() as usize;
        use ring::rand::{SystemRandom, SecureRandom};
        let mut bytes = vec![0u8; size];
        let rand = SystemRandom::new();
        rand.fill(&mut bytes).unwrap();
        use boa_engine::object::builtins::JsUint8Array;
        Ok(JsValue::from(JsUint8Array::from_iter(bytes, ctx).unwrap()))
    });
    let crypto_native = ObjectInitializer::new(context).function(rust_crypto_hash, JsString::from("hash"), 2).function(rust_crypto_random, JsString::from("randomBytes"), 1).build();
    let _ = context.register_global_property(JsString::from("__rust_crypto"), crypto_native, Attribute::all());

    let elixir_pid = pid.clone();
    let rust_send = NativeFunction::from_copy_closure(move |_this, args, ctx| {
        let payload = args.get_or_undefined(0).to_string(ctx).unwrap().to_std_string_escaped();
        let mut owned_env = OwnedEnv::new();
        let _ = owned_env.send_and_clear(&elixir_pid, |env| payload.encode(env));
        Ok(JsValue::undefined())
    });
    let send_wrapper = ObjectInitializer::new(context).function(rust_send, JsString::from("send"), 1).build();
    let _ = context.register_global_property(JsString::from("__elixir_send"), send_wrapper, Attribute::all());

    if let Ok(bootstrap) = fs::read_to_string("lib/node_compat/bootstrap.js") {
        let _ = context.eval(Source::from_bytes(bootstrap.as_bytes()));
    }
}

#[rustler::nif]
fn run_js(env: Env, code: String) -> NifResult<String> {
    let mut context = Context::default();
    setup_context(&mut context, env.pid());
    match context.eval(Source::from_bytes(code.as_bytes())) {
        Ok(v) => Ok(v.to_string(&mut context).unwrap().to_std_string_escaped()),
        Err(e) => Err(rustler::Error::Term(Box::new(format!("JS Error: {:?}", e))))
    }
}

#[rustler::nif]
fn init_runtime(env: Env) -> ResourceArc<Runtime> {
    let pid = env.pid();
    let (tx, rx) = channel::<Box<dyn FnOnce(&mut Context) + Send>>();
    thread::spawn(move || {
        let mut context = Context::default();
        setup_context(&mut context, pid);
        while let Ok(job) = rx.recv() { job(&mut context); }
    });
    ResourceArc::new(Runtime { tx })
}

#[rustler::nif]
fn eval_js(resource: ResourceArc<Runtime>, code: Binary) -> NifResult<String> {
    let (res_tx, res_rx) = channel::<Result<String, String>>();
    let code_vec = code.as_slice().to_vec();
    resource.tx.send(Box::new(move |context| {
        let result = match context.eval(Source::from_bytes(&code_vec)) {
            Ok(v) => { let _ = context.run_jobs(); Ok(v.to_string(context).unwrap().to_std_string_escaped()) },
            Err(e) => Err(format!("JS Error: {}", e))
        };
        let _ = res_tx.send(result);
    })).map_err(|e| rustler::Error::Term(Box::new(e.to_string())))?;
    res_rx.recv().map_err(|e| rustler::Error::Term(Box::new(e.to_string())))?.map_err(|e| rustler::Error::Term(Box::new(e)))
}

#[rustler::nif]
fn push_binary(resource: ResourceArc<Runtime>, id: String, data: Binary) -> NifResult<String> {
    let (res_tx, res_rx) = channel::<Result<String, String>>();
    let data_vec = data.as_slice().to_vec(); 
    resource.tx.send(Box::new(move |context| {
        use boa_engine::object::builtins::JsUint8Array;
        let uint8_array = JsUint8Array::from_iter(data_vec, context).unwrap();
        let val = JsValue::from(uint8_array);
        let global = context.global_object();
        if let Ok(registry) = global.get(JsString::from("__transfer_registry"), context) {
            if let Some(obj) = registry.as_object() {
                let _ = obj.set(JsString::from(id), val, false, context);
            }
        }
        let _ = res_tx.send(Ok("ok".to_string()));
    })).map_err(|e| rustler::Error::Term(Box::new(e.to_string())))?;
    res_rx.recv().map_err(|e| rustler::Error::Term(Box::new(e.to_string())))?.map_err(|e| rustler::Error::Term(Box::new(e)))
}

#[rustler::nif]
fn load_native_module(resource: ResourceArc<Runtime>, path: String) -> NifResult<String> {
    let (res_tx, res_rx) = channel::<Result<String, String>>();
    resource.tx.send(Box::new(move |context| {
        unsafe {
            match Library::new(&path) {
                Ok(lib) => {
                    if let Ok(init_fn) = lib.get::<Symbol<unsafe extern "C" fn(*mut Context)>>(b"init_module") {
                        init_fn(context);
                        let _ = res_tx.send(Ok("Module chargé avec succès".to_string()));
                    } else {
                        let _ = res_tx.send(Err("Symbole 'init_module' non trouvé".to_string()));
                    }
                    std::mem::forget(lib); 
                },
                Err(e) => { let _ = res_tx.send(Err(format!("Erreur libloading : {}", e))); }
            }
        }
    })).map_err(|e| rustler::Error::Term(Box::new(e.to_string())))?;
    res_rx.recv().map_err(|e| rustler::Error::Term(Box::new(e.to_string())))?.map_err(|e| rustler::Error::Term(Box::new(e)))
}

rustler::init!("Elixir.BunNext.Native", [
    parse_package_json, save_to_cache, resolve_deps, transpile_ts, extract_tgz, bundle_simple, run_js, init_runtime, eval_js, push_binary, load_native_module
], load = on_load);
