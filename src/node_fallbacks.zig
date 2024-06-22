const std = @import("std");
const string = @import("./string_types.zig").string;
const PackageJSON = @import("./resolver/package_json.zig").PackageJSON;
const logger = bun.logger;
const Fs = @import("./fs.zig");
const bun = @import("root").bun;

const assert_code: string = @embedFile("./node-fallbacks/out/assert.js");
const buffer_code: string = @embedFile("./node-fallbacks/out/buffer.js");
const console_code: string = @embedFile("./node-fallbacks/out/console.js");
const constants_code: string = @embedFile("./node-fallbacks/out/constants.js");
const crypto_code: string = @embedFile("./node-fallbacks/out/crypto.js");
const domain_code: string = @embedFile("./node-fallbacks/out/domain.js");
const events_code: string = @embedFile("./node-fallbacks/out/events.js");
const http_code: string = @embedFile("./node-fallbacks/out/http.js");
const https_code: string = @embedFile("./node-fallbacks/out/https.js");
const net_code: string = @embedFile("./node-fallbacks/out/net.js");
const os_code: string = @embedFile("./node-fallbacks/out/os.js");
const path_code: string = @embedFile("./node-fallbacks/out/path.js");
const process_code: string = @embedFile("./node-fallbacks/out/process.js");
const punycode_code: string = @embedFile("./node-fallbacks/out/punycode.js");
const querystring_code: string = @embedFile("./node-fallbacks/out/querystring.js");
const stream_code: string = @embedFile("./node-fallbacks/out/stream.js");
const string_decoder_code: string = @embedFile("./node-fallbacks/out/string_decoder.js");
const sys_code: string = @embedFile("./node-fallbacks/out/sys.js");
const timers_code: string = @embedFile("./node-fallbacks/out/timers.js");
const tty_code: string = @embedFile("./node-fallbacks/out/tty.js");
const url_code: string = @embedFile("./node-fallbacks/out/url.js");
const util_code: string = @embedFile("./node-fallbacks/out/util.js");
const zlib_code: string = @embedFile("./node-fallbacks/out/zlib.js");

const assert_import_path = "/bun-vfs/node_modules/assert/index.js";
const buffer_import_path = "/bun-vfs/node_modules/buffer/index.js";
const console_import_path = "/bun-vfs/node_modules/console/index.js";
const constants_import_path = "/bun-vfs/node_modules/constants/index.js";
const crypto_import_path = "/bun-vfs/node_modules/crypto/index.js";
const domain_import_path = "/bun-vfs/node_modules/domain/index.js";
const events_import_path = "/bun-vfs/node_modules/events/index.js";
const http_import_path = "/bun-vfs/node_modules/http/index.js";
const https_import_path = "/bun-vfs/node_modules/https/index.js";
const net_import_path = "/bun-vfs/node_modules/net/index.js";
const os_import_path = "/bun-vfs/node_modules/os/index.js";
const path_import_path = "/bun-vfs/node_modules/path/index.js";
const process_import_path = "/bun-vfs/node_modules/process/index.js";
const punycode_import_path = "/bun-vfs/node_modules/punycode/index.js";
const querystring_import_path = "/bun-vfs/node_modules/querystring/index.js";
const stream_import_path = "/bun-vfs/node_modules/stream/index.js";
const string_decoder_import_path = "/bun-vfs/node_modules/string_decoder/index.js";
const sys_import_path = "/bun-vfs/node_modules/sys/index.js";
const timers_import_path = "/bun-vfs/node_modules/timers/index.js";
const tty_import_path = "/bun-vfs/node_modules/tty/index.js";
const url_import_path = "/bun-vfs/node_modules/url/index.js";
const util_import_path = "/bun-vfs/node_modules/util/index.js";
const zlib_import_path = "/bun-vfs/node_modules/zlib/index.js";

const assert_package_json = PackageJSON{
    .name = "assert",
    .version = "0.0.0-polyfill",
    .module_type = .esm,
    .hash = @as(u32, @truncate(bun.hash("assert@0.0.0-polyfill"))),
    .main_fields = undefined,
    .browser_map = undefined,
    .source = logger.Source.initPathString("/bun-vfs/node_modules/assert/package.json", ""),
};
const buffer_package_json = PackageJSON{
    .name = "buffer",
    .version = "0.0.0-polyfill",
    .module_type = .esm,
    .hash = @as(u32, @truncate(bun.hash("buffer@0.0.0-polyfill"))),
    .main_fields = undefined,
    .browser_map = undefined,
    .source = logger.Source.initPathString("/bun-vfs/node_modules/buffer/package.json", ""),
};
const console_package_json = PackageJSON{
    .name = "console",
    .version = "0.0.0-polyfill",
    .module_type = .esm,
    .hash = @as(u32, @truncate(bun.hash("console@0.0.0-polyfill"))),
    .main_fields = undefined,
    .browser_map = undefined,
    .source = logger.Source.initPathString("/bun-vfs/node_modules/console/package.json", ""),
};
const constants_package_json = PackageJSON{
    .name = "constants",
    .version = "0.0.0-polyfill",
    .module_type = .esm,
    .hash = @as(u32, @truncate(bun.hash("constants@0.0.0-polyfill"))),
    .main_fields = undefined,
    .browser_map = undefined,
    .source = logger.Source.initPathString("/bun-vfs/node_modules/constants/package.json", ""),
};
const crypto_package_json = PackageJSON{
    .name = "crypto",
    .version = "0.0.0-polyfill",
    .module_type = .esm,
    .hash = @as(u32, @truncate(bun.hash("crypto@0.0.0-polyfill"))),
    .main_fields = undefined,
    .browser_map = undefined,
    .source = logger.Source.initPathString("/bun-vfs/node_modules/crypto/package.json", ""),
};
const domain_package_json = PackageJSON{
    .name = "domain",
    .version = "0.0.0-polyfill",
    .module_type = .esm,
    .hash = @as(u32, @truncate(bun.hash("domain@0.0.0-polyfill"))),
    .main_fields = undefined,
    .browser_map = undefined,
    .source = logger.Source.initPathString("/bun-vfs/node_modules/domain/package.json", ""),
};
const events_package_json = PackageJSON{
    .name = "events",
    .version = "0.0.0-polyfill",
    .module_type = .esm,
    .hash = @as(u32, @truncate(bun.hash("events@0.0.0-polyfill"))),
    .main_fields = undefined,
    .browser_map = undefined,
    .source = logger.Source.initPathString("/bun-vfs/node_modules/events/package.json", ""),
};
const http_package_json = PackageJSON{
    .name = "http",
    .version = "0.0.0-polyfill",
    .module_type = .esm,
    .hash = @as(u32, @truncate(bun.hash("http@0.0.0-polyfill"))),
    .main_fields = undefined,
    .browser_map = undefined,
    .source = logger.Source.initPathString("/bun-vfs/node_modules/http/package.json", ""),
};
const https_package_json = PackageJSON{
    .name = "https",
    .version = "0.0.0-polyfill",
    .module_type = .esm,
    .hash = @as(u32, @truncate(bun.hash("https@0.0.0-polyfill"))),
    .main_fields = undefined,
    .browser_map = undefined,
    .source = logger.Source.initPathString("/bun-vfs/node_modules/https/package.json", ""),
};
const net_package_json = PackageJSON{
    .name = "net",
    .version = "0.0.0-polyfill",
    .module_type = .esm,
    .hash = @as(u32, @truncate(bun.hash("net@0.0.0-polyfill"))),
    .main_fields = undefined,
    .browser_map = undefined,
    .source = logger.Source.initPathString("/bun-vfs/node_modules/net/package.json", ""),
};
const os_package_json = PackageJSON{
    .name = "os",
    .version = "0.0.0-polyfill",
    .module_type = .esm,
    .hash = @as(u32, @truncate(bun.hash("os@0.0.0-polyfill"))),
    .main_fields = undefined,
    .browser_map = undefined,
    .source = logger.Source.initPathString("/bun-vfs/node_modules/os/package.json", ""),
};
const path_package_json = PackageJSON{
    .name = "path",
    .version = "0.0.0-polyfill",
    .module_type = .esm,
    .hash = @as(u32, @truncate(bun.hash("path@0.0.0-polyfill"))),
    .main_fields = undefined,
    .browser_map = undefined,
    .source = logger.Source.initPathString("/bun-vfs/node_modules/path/package.json", ""),
};
const process_package_json = PackageJSON{
    .name = "process",
    .version = "0.0.0-polyfill",
    .module_type = .esm,
    .hash = @as(u32, @truncate(bun.hash("process@0.0.0-polyfill"))),
    .main_fields = undefined,
    .browser_map = undefined,
    .source = logger.Source.initPathString("/bun-vfs/node_modules/process/package.json", ""),
};
const punycode_package_json = PackageJSON{
    .name = "punycode",
    .version = "0.0.0-polyfill",
    .module_type = .esm,
    .hash = @as(u32, @truncate(bun.hash("punycode@0.0.0-polyfill"))),
    .main_fields = undefined,
    .browser_map = undefined,
    .source = logger.Source.initPathString("/bun-vfs/node_modules/punycode/package.json", ""),
};
const querystring_package_json = PackageJSON{
    .name = "querystring",
    .version = "0.0.0-polyfill",
    .module_type = .esm,
    .hash = @as(u32, @truncate(bun.hash("querystring@0.0.0-polyfill"))),
    .main_fields = undefined,
    .browser_map = undefined,
    .source = logger.Source.initPathString("/bun-vfs/node_modules/querystring/package.json", ""),
};
const stream_package_json = PackageJSON{
    .name = "stream",
    .version = "0.0.0-polyfill",
    .module_type = .esm,
    .hash = @as(u32, @truncate(bun.hash("stream@0.0.0-polyfill"))),
    .main_fields = undefined,
    .browser_map = undefined,
    .source = logger.Source.initPathString("/bun-vfs/node_modules/stream/package.json", ""),
};
const string_decoder_package_json = PackageJSON{
    .name = "string_decoder",
    .version = "0.0.0-polyfill",
    .module_type = .esm,
    .hash = brk: {
        @setEvalBranchQuota(9999);
        break :brk @as(u32, @truncate(bun.hash("string_decoder@0.0.0-polyfill")));
    },

    .main_fields = undefined,
    .browser_map = undefined,
    .source = logger.Source.initPathString("/bun-vfs/node_modules/string_decoder/package.json", ""),
};

const sys_package_json = PackageJSON{
    .name = "sys",
    .version = "0.0.0-polyfill",
    .module_type = .esm,
    .hash = @as(u32, @truncate(bun.hash("sys@0.0.0-polyfill"))),
    .main_fields = undefined,
    .browser_map = undefined,
    .source = logger.Source.initPathString("/bun-vfs/node_modules/sys/package.json", ""),
};
const timers_package_json = PackageJSON{
    .name = "timers",
    .version = "0.0.0-polyfill",
    .module_type = .esm,
    .hash = @as(u32, @truncate(bun.hash("timers@0.0.0-polyfill"))),
    .main_fields = undefined,
    .browser_map = undefined,
    .source = logger.Source.initPathString("/bun-vfs/node_modules/timers/package.json", ""),
};
const tty_package_json = PackageJSON{
    .name = "tty",
    .version = "0.0.0-polyfill",
    .module_type = .esm,
    .hash = @as(u32, @truncate(bun.hash("tty@0.0.0-polyfill"))),
    .main_fields = undefined,
    .browser_map = undefined,
    .source = logger.Source.initPathString("/bun-vfs/node_modules/tty/package.json", ""),
};
const url_package_json = PackageJSON{
    .name = "url",
    .version = "0.0.0-polyfill",
    .module_type = .esm,
    .hash = @as(u32, @truncate(bun.hash("url@0.0.0-polyfill"))),
    .main_fields = undefined,
    .browser_map = undefined,
    .source = logger.Source.initPathString("/bun-vfs/node_modules/url/package.json", ""),
};
const util_package_json = PackageJSON{
    .name = "util",
    .version = "0.0.0-polyfill",
    .module_type = .esm,
    .hash = @as(u32, @truncate(bun.hash("util@0.0.0-polyfill"))),
    .main_fields = undefined,
    .browser_map = undefined,
    .source = logger.Source.initPathString("/bun-vfs/node_modules/util/package.json", ""),
};
const zlib_package_json = PackageJSON{
    .name = "zlib",
    .version = "0.0.0-polyfill",
    .module_type = .esm,
    .hash = @as(u32, @truncate(bun.hash("zlib@0.0.0-polyfill"))),
    .main_fields = undefined,
    .browser_map = undefined,
    .source = logger.Source.initPathString("/bun-vfs/node_modules/zlib/package.json", ""),
};

pub const FallbackModule = struct {
    path: Fs.Path,
    code: string,
    package_json: *const PackageJSON,

    pub const assert = FallbackModule{
        .path = Fs.Path.initWithNamespaceVirtual(assert_import_path, "node", "assert"),
        .code = assert_code,
        .package_json = &assert_package_json,
    };
    pub const buffer = FallbackModule{
        .path = Fs.Path.initWithNamespaceVirtual(buffer_import_path, "node", "buffer"),
        .code = buffer_code,
        .package_json = &buffer_package_json,
    };
    pub const console = FallbackModule{
        .path = Fs.Path.initWithNamespaceVirtual(console_import_path, "node", "console"),
        .code = console_code,
        .package_json = &console_package_json,
    };
    pub const constants = FallbackModule{
        .path = Fs.Path.initWithNamespaceVirtual(constants_import_path, "node", "constants"),
        .code = constants_code,
        .package_json = &constants_package_json,
    };
    pub const crypto = FallbackModule{
        .path = Fs.Path.initWithNamespaceVirtual(crypto_import_path, "node", "crypto"),
        .code = crypto_code,
        .package_json = &crypto_package_json,
    };
    pub const domain = FallbackModule{
        .path = Fs.Path.initWithNamespaceVirtual(domain_import_path, "node", "domain"),
        .code = domain_code,
        .package_json = &domain_package_json,
    };
    pub const events = FallbackModule{
        .path = Fs.Path.initWithNamespaceVirtual(events_import_path, "node", "events"),
        .code = events_code,
        .package_json = &events_package_json,
    };
    pub const http = FallbackModule{
        .path = Fs.Path.initWithNamespaceVirtual(http_import_path, "node", "http"),
        .code = http_code,
        .package_json = &http_package_json,
    };
    pub const https = FallbackModule{
        .path = Fs.Path.initWithNamespaceVirtual(https_import_path, "node", "https"),
        .code = https_code,
        .package_json = &https_package_json,
    };
    pub const net = FallbackModule{
        .path = Fs.Path.initWithNamespaceVirtual(net_import_path, "node", "net"),
        .code = net_code,
        .package_json = &net_package_json,
    };
    pub const os = FallbackModule{
        .path = Fs.Path.initWithNamespaceVirtual(os_import_path, "node", "os"),
        .code = os_code,
        .package_json = &os_package_json,
    };
    pub const path = FallbackModule{
        .path = Fs.Path.initWithNamespaceVirtual(path_import_path, "node", "path"),
        .code = path_code,
        .package_json = &path_package_json,
    };
    pub const process = FallbackModule{
        .path = Fs.Path.initWithNamespaceVirtual(process_import_path, "node", "process"),
        .code = process_code,
        .package_json = &process_package_json,
    };
    pub const punycode = FallbackModule{
        .path = Fs.Path.initWithNamespaceVirtual(punycode_import_path, "node", "punycode"),
        .code = punycode_code,
        .package_json = &punycode_package_json,
    };
    pub const querystring = FallbackModule{
        .path = Fs.Path.initWithNamespaceVirtual(querystring_import_path, "node", "querystring"),
        .code = querystring_code,
        .package_json = &querystring_package_json,
    };
    pub const stream = FallbackModule{
        .path = Fs.Path.initWithNamespaceVirtual(stream_import_path, "node", "stream"),
        .code = stream_code,
        .package_json = &stream_package_json,
    };
    pub const string_decoder = FallbackModule{
        .path = Fs.Path.initWithNamespaceVirtual(string_decoder_import_path, "node", "string_decoder"),
        .code = string_decoder_code,
        .package_json = &string_decoder_package_json,
    };
    pub const sys = FallbackModule{
        .path = Fs.Path.initWithNamespaceVirtual(sys_import_path, "node", "sys"),
        .code = sys_code,
        .package_json = &sys_package_json,
    };
    pub const timers = FallbackModule{
        .path = Fs.Path.initWithNamespaceVirtual(timers_import_path, "node", "timers"),
        .code = timers_code,
        .package_json = &timers_package_json,
    };
    pub const tty = FallbackModule{
        .path = Fs.Path.initWithNamespaceVirtual(tty_import_path, "node", "tty"),
        .code = tty_code,
        .package_json = &tty_package_json,
    };
    pub const url = FallbackModule{
        .path = Fs.Path.initWithNamespaceVirtual(url_import_path, "node", "url"),
        .code = url_code,
        .package_json = &url_package_json,
    };
    pub const util = FallbackModule{
        .path = Fs.Path.initWithNamespaceVirtual(util_import_path, "node", "util"),
        .code = util_code,
        .package_json = &util_package_json,
    };
    pub const zlib = FallbackModule{
        .path = Fs.Path.initWithNamespaceVirtual(zlib_import_path, "node", "zlib"),
        .code = zlib_code,
        .package_json = &zlib_package_json,
    };
};

pub const Map = bun.ComptimeStringMap(FallbackModule, .{
    .{ "assert", FallbackModule.assert },
    .{ "buffer", FallbackModule.buffer },
    .{ "console", FallbackModule.console },
    .{ "constants", FallbackModule.constants },
    .{ "crypto", FallbackModule.crypto },
    .{ "domain", FallbackModule.domain },
    .{ "events", FallbackModule.events },
    .{ "http", FallbackModule.http },
    .{ "https", FallbackModule.https },
    .{ "net", FallbackModule.net },
    .{ "os", FallbackModule.os },
    .{ "path", FallbackModule.path },
    .{ "process", FallbackModule.process },
    .{ "punycode", FallbackModule.punycode },
    .{ "querystring", FallbackModule.querystring },
    .{ "stream", FallbackModule.stream },
    .{ "string_decoder", FallbackModule.string_decoder },
    .{ "sys", FallbackModule.sys },
    .{ "timers", FallbackModule.timers },
    .{ "tty", FallbackModule.tty },
    .{ "url", FallbackModule.url },
    .{ "util", FallbackModule.util },
    .{ "zlib", FallbackModule.zlib },
});

pub fn contentsFromPath(path: string) ?string {
    @setCold(true);
    var module_name = path["/bun-vfs/node_modules/".len..];

    if (module_name[0] == '@') {
        var end = std.mem.indexOfScalar(u8, module_name, '/').? + 1;
        end += std.mem.indexOfScalar(u8, module_name[end..], '/').?;

        module_name = module_name[0..end];
    } else {
        module_name = module_name[0..std.mem.indexOfScalar(u8, module_name, '/').?];
    }

    if (Map.get(module_name)) |mod| {
        return mod.code;
    }
    return null;
}

pub const buffer_fallback_import_name: string = "node:buffer";
