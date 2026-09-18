IO.puts "--- Bun-Next : Diagnostic de require Statique ---"

js_code = """
try {
  console.log("Loading path...");
  require("path");
  console.log("-> path loaded");
} catch(e) {
  console.log("-> path error:", e.message);
  if (e.stack) console.log(e.stack);
}

try {
  console.log("Loading internal/util/types...");
  require("internal/util/types");
  console.log("-> internal/util/types loaded");
} catch(e) {
  console.log("-> internal/util/types error:", e.message);
  if (e.stack) console.log(e.stack);
}

try {
  console.log("Loading buffer...");
  require("buffer");
  console.log("-> buffer loaded");
} catch(e) {
  console.log("-> buffer error:", e.message);
  if (e.stack) console.log(e.stack);
}

try {
  console.log("Loading internal/errors...");
  const errs = require("internal/errors");
  console.log("-> internal/errors loaded");
} catch(e) {
  console.log("-> internal/errors error:", e.message);
  if (e.stack) console.log(e.stack);
}

try {
  console.log("Loading internal/options...");
  require("internal/options");
  console.log("-> internal/options loaded");
} catch(e) {
  console.log("-> internal/options error:", e.message);
  if (e.stack) console.log(e.stack);
}

try {
  console.log("Loading internal/validators...");
  require("internal/validators");
  console.log("-> internal/validators loaded");
} catch(e) {
  console.log("-> internal/validators error:", e.message);
  if (e.stack) console.log(e.stack);
}

try {
  console.log("Loading internal/util...");
  const utilModule = require("internal/util");
  console.log("-> internal/util loaded, deprecate type:", typeof utilModule.deprecate);
} catch(e) {
  console.log("-> internal/util error:", e.message);
  if (e.stack) console.log(e.stack);
}

try {
  console.log("Loading internal/buffer...");
  require("internal/buffer");
  console.log("-> internal/buffer loaded");
} catch(e) {
  console.log("-> internal/buffer error:", e.message);
  if (e.stack) console.log(e.stack);
}

try {
  console.log("Loading internal/encoding/single-byte...");
  require("internal/encoding/single-byte");
  console.log("-> internal/encoding/single-byte loaded");
} catch(e) {
  console.log("-> internal/encoding/single-byte error:", e.message);
  if (e.stack) console.log(e.stack);
}

try {
  console.log("Loading internal/encoding/util...");
  require("internal/encoding/util");
  console.log("-> internal/encoding/util loaded");
} catch(e) {
  console.log("-> internal/encoding/util error:", e.message);
  if (e.stack) console.log(e.stack);
}

try {
  console.log("Loading internal/encoding...");
  require("internal/encoding");
  console.log("-> internal/encoding loaded");
} catch(e) {
  console.log("-> internal/encoding error:", e.message);
  if (e.stack) console.log(e.stack);
}

try {
  console.log("Loading internal/url...");
  require("internal/url");
  console.log("-> internal/url loaded");
} catch(e) {
  console.log("-> internal/url error:", e.message);
  if (e.stack) console.log(e.stack);
}

console.log("--- BLOB DEPENDENCIES ---");

try {
  console.log("Loading internal/worker/js_transferable...");
  require("internal/worker/js_transferable");
  console.log("-> internal/worker/js_transferable loaded");
} catch(e) {
  console.log("-> internal/worker/js_transferable error:", e.message);
  if (e.stack) console.log(e.stack);
}

try {
  console.log("Loading internal/util/inspect...");
  require("internal/util/inspect");
  console.log("-> internal/util/inspect loaded");
} catch(e) {
  console.log("-> internal/util/inspect error:", e.message);
  console.log("Error Name:", e.name);
  console.log("Error Stack:", e.stack);
  try {
    for (let k of Object.getOwnPropertyNames(e)) {
      console.log("Prop:", k, "value:", e[k]);
    }
  } catch(err) {}
}

try {
  console.log("Loading internal/webidl...");
  require("internal/webidl");
  console.log("-> internal/webidl loaded");
} catch(e) {
  console.log("-> internal/webidl error:", e.message);
  if (e.stack) console.log(e.stack);
}

try {
  console.log("Loading timers...");
  require("timers");
  console.log("-> timers loaded");
} catch(e) {
  console.log("-> timers error:", e.message);
  if (e.stack) console.log(e.stack);
}

try {
  console.log("Loading internal/process/task_queues...");
  require("internal/process/task_queues");
  console.log("-> internal/process/task_queues loaded");
} catch(e) {
  console.log("-> internal/process/task_queues error:", e.message);
  if (e.stack) console.log(e.stack);
}

console.log("--- LOADING BLOB ---");
try {
  console.log("Loading internal/blob...");
  require("internal/blob");
  console.log("-> internal/blob loaded");
} catch(e) {
  console.log("-> internal/blob error:", e.message);
  if (e.stack) console.log(e.stack);
}

console.log("--- LOADING FS ---");
try {
  console.log("Loading ./node_source/node-26.0.0/lib/fs.js...");
  try {
    console.log("Loading internal/fs/utils...");
    require("internal/fs/utils");
    console.log("-> internal/fs/utils loaded");
  } catch(e) {
    console.log("-> internal/fs/utils error:", e.message);
    console.log("Error Name:", e.name);
    console.log("Error Stack:", e.stack);
    try {
      for (let k of Object.getOwnPropertyNames(e)) {
        console.log("Prop:", k, "value:", e[k]);
      }
    } catch(err) {}
  }
  try {
    console.log("Loading internal/constants...");
    require("internal/constants");
    console.log("-> internal/constants loaded");
  } catch(e) {
    console.log("-> internal/constants error:", e.message);
    if (e.stack) console.log(e.stack);
  }
  try {
    console.log("Loading internal/process/permission...");
    require("internal/process/permission");
    console.log("-> internal/process/permission loaded");
  } catch(e) {
    console.log("-> internal/process/permission error:", e.message);
    if (e.stack) console.log(e.stack);
  }
  require("./node_source/node-26.0.0/lib/fs.js");
  console.log("-> ./node_source/node-26.0.0/lib/fs.js loaded");
} catch(e) {
  console.log("-> ./node_source/node-26.0.0/lib/fs.js error:", e.message);
  if (e.stack) console.log(e.stack);
}
"""

File.write!("test_require.js", js_code)

case BunNext.Bundler.bundle_and_run("test_require.js") do
  result when is_binary(result) ->
    IO.puts "\n✅ Exécution terminée."
  {:error, reason} ->
    IO.puts "\n❌ Erreur : #{reason}"
end

File.rm!("test_require.js")
