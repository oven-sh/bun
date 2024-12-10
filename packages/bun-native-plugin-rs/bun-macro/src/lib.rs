use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, Ident, ItemFn};

#[proc_macro_attribute]
pub fn bun(_attr: TokenStream, item: TokenStream) -> TokenStream {
    // Parse the input function
    let input_fn = parse_macro_input!(item as ItemFn);
    let fn_name = &input_fn.sig.ident;
    let inner_fn_name = Ident::new(&format!("__{}", fn_name), fn_name.span());
    let fn_block = &input_fn.block;

    // Generate the wrapped function
    let output = quote! {
        #[no_mangle]
        pub unsafe extern "C" fn #fn_name(
            args_raw: *mut bun_native_plugin::sys::OnBeforeParseArguments,
            result: *mut bun_native_plugin::sys::OnBeforeParseResult,
        ) {
            fn #inner_fn_name(handle: &mut bun_native_plugin::OnBeforeParse) -> Result<()>  {
                #fn_block
            }

            let args_path = unsafe { (*args_raw).path_ptr };
            let args_path_len = unsafe { (*args_raw).path_len };
            let result_pointer = result;

            let result = std::panic::catch_unwind(|| {
                let mut handle = match bun_native_plugin::OnBeforeParse::from_raw(args_raw, result) {
                    Ok(handle) => handle,
                    Err(_) => return,
                };
                if let Err(e) = #inner_fn_name(&mut handle) {
                    handle.log_error(&format!("{:?}", e));
                }
            });

            if let Err(e) = result {
                let msg_string = format!("Plugin crashed: {:?}", e);
                let mut log_options = bun_native_plugin::log_from_message_and_level(
                    &msg_string,
                    bun_native_plugin::sys::BunLogLevel::BUN_LOG_LEVEL_ERROR,
                    args_path,
                    args_path_len,
                );
                unsafe {
                    ((*result_pointer).log.unwrap())(args_raw, &mut log_options);
                }
            }
        }
    };

    output.into()
}
