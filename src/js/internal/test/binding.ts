function internalBinding(name: string) {
  switch (name) {
    case "async_wrap":
    case "buffer":
    case "cares_wrap":
    case "constants":
    case "contextify":
    case "config":
    case "fs":
    case "fs_event_wrap":
    case "http_parser":
    case "inspector":
    case "os":
    case "pipe_wrap":
    case "process_wrap":
    case "signal_wrap":
    case "tcp_wrap":
    case "tty_wrap":
    case "udp_wrap":
    case "url":
    case "util":
    case "uv":
    case "v8":
    case "zlib":
    case "js_stream": {
      // Public bindings
      return (process as any).binding(name);
    }

    case "blob":
    case "block_list":
    case "builtins":
    case "credentials":
    case "encoding_binding":
    case "errors":
    case "fs_dir":
    case "heap_utils":
    case "http2":
    case "internal_only_v8":
    case "js_udp_wrap":
    case "messaging":
    case "modules":
    case "module_wrap":
    case "mksnapshot":
    case "options":
    case "performance":
    case "permission":
    case "process_methods":
    case "report":
    case "sea":
    case "serdes":
    case "spawn_sync":
    case "stream_pipe":
    case "stream_wrap":
    case "string_decoder":
    case "symbols":
    case "task_queue":
    case "timers":
    case "trace_events":
    case "types":
    case "wasi":
    case "wasm_web_api":
    case "watchdog":
    case "worker": {
      // Private bindings
      throw new Error(
        `Bun does not implement internal binding: ${name}. This being a node.js internal, it will not be implemented outside of usage in Node.js' test suite.`,
      );
    }

    default: {
      throw new Error(`No such binding: ${name}`);
    }
  }
}

export { internalBinding };
