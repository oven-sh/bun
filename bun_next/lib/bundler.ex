defmodule BunNext.Bundler do
  @moduledoc """
  Orchestre l'assemblage final des modules et leur transformation.
  """

  def bundle(entry_path) do
    wrapper_path = create_entry_wrapper(entry_path)
    case BunNext.Native.bundle_simple(wrapper_path) do
      modules when is_list(modules) ->
        File.rm!(wrapper_path)
        {:ok, assemble_bundle(modules, wrapper_path)}
      {:error, reason} ->
        File.rm(wrapper_path)
        {:error, reason}
    end
  end

  def bundle_and_run(entry_path) do
    wrapper_path = create_entry_wrapper(entry_path)
    case BunNext.Native.bundle_simple(wrapper_path) do
      modules when is_list(modules) ->
        File.rm!(wrapper_path)
        bundle = assemble_bundle(modules, wrapper_path)
        BunNext.Native.run_js(bundle)
      {:error, reason} ->
        File.rm(wrapper_path)
        {:error, reason}
    end
  end

  defp create_entry_wrapper(entry_path) do
    target = 
      if String.starts_with?(entry_path, "node_compat/") or String.starts_with?(entry_path, "lib/") do
        entry_path |> Path.expand() |> Path.relative_to(File.cwd!()) |> String.replace("\\", "/")
      else
        entry_path |> Path.expand() |> Path.relative_to(File.cwd!()) |> String.replace("\\", "/")
      end
    
    content = """
    require("path");
    require("internal/util/types");
    require("buffer");
    require("internal/errors");
    require("internal/options");
    require("internal/validators");
    require("internal/util");
    require("internal/buffer");
    require("internal/encoding/single-byte");
    require("internal/encoding/util");
    require("internal/encoding");
    require("internal/url");
    require("internal/worker/js_transferable");
    require("internal/util/inspect");
    require("internal/webidl");
    require("timers");
    require("internal/process/task_queues");
    require("internal/blob");
    require("internal/fs/utils");
    require("internal/constants");
    require("internal/process/permission");
    module.exports = require("./#{target}");
    """
    wrapper_path = "__entry_wrapper.js"
    File.write!(wrapper_path, content)
    wrapper_path
  end

  defp assemble_bundle(modules, entry_path) do
    root_path = File.cwd!()

    modules_js = modules
    |> Enum.map(fn %{path: path, source: source} ->
      # On garde l'ID tel quel si c'est node:*, sinon on transforme en chemin relatif
      clean_id = 
        if String.starts_with?(path, "node:") do
          path
        else
          path 
          |> Path.expand() 
          |> Path.relative_to(root_path) 
          |> String.replace("\\", "/")
        end
      
      """
      "#{clean_id}": function(exports, __require_internal, module) {
        const require = __require_internal;
        #{source}
      }
      """
    end)
    |> Enum.join(",\n")

    entry_rel = entry_path |> Path.expand() |> Path.relative_to(root_path) |> String.replace("\\", "/")

    bundle = """
    (function() {
      const __modules = {
        #{modules_js}
      };
      const __cache = {};

      function __internal_require(id) {
        if (__cache[id]) return __cache[id].exports;
        
        // Résolution d'ID
        let key = id;
        if (!__modules[key]) {
           // Essai avec .js
           if (__modules[id + '.js']) key = id + '.js';
           // Essai avec node: prefix
           else if (!id.startsWith('node:') && __modules['node:' + id]) key = 'node:' + id;
           // Essai sans node: prefix
           else if (id.startsWith('node:') && __modules[id.substring(5)]) key = id.substring(5);
           // Recherche floue par fin de chemin
           else {
             const allKeys = Object.keys(__modules);
             const cleanId = id.replace(/^node:/, '').replace(/^\\.\\//, '');
             const target = cleanId.split('/').pop().replace('.js', '');
             const isInternal = id.includes('internal/');
             key = allKeys.find(k => {
                if (isInternal && !k.includes('internal/')) return false;
                const cleanK = k.replace('node:', '').replace('.js', '');
                return k.endsWith('/' + cleanId) || k.endsWith('/' + cleanId + '.js') || cleanK === target || cleanK.endsWith('/' + target);
             });
           }
        }

        if (!key || !__modules[key]) {
           console.log("Module NOT FOUND:", id);
           console.log("Available Keys:", Object.keys(__modules).join(", "));
           // Si c'est un module vraiment natif non bundlé
           if (typeof require !== 'undefined') {
              try { return require(id); } catch(e) {}
           }
           throw new Error("Module not found: " + id + " (Keys: " + Object.keys(__modules).length + ")");
        }

        const fn = __modules[key];
        const module = { exports: {} };
        __cache[key] = module;
        
        fn(module.exports, __internal_require, module);
        return module.exports;
      }

      return __internal_require("#{entry_rel}");
    })();
    """

    File.write!("debug_bundle.js", bundle)
    bundle
  end
end
