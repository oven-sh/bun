const log = Output.scoped(.bake_prod, .visible);
const httplog = log;

pub fn ProductionServerMethods(protocol_enum: bun.api.server.Protocol, development_kind: bun.api.server.DevelopmentKind) type {
    return struct {
        const Server = bun.api.server.NewServer(protocol_enum, development_kind);
        const ThisServer = Server;
        const App = Server.App;
        const ssl_enabled = Server.ssl_enabled;

        pub fn bakeProductionSSRRouteHandler(server: *ThisServer, req: *uws.Request, resp: *App.Response) void {
            bakeProductionSSRRouteHandlerWithURL(server, req, resp, req.url());
        }

        pub fn bakeProductionSSRRouteHandlerWithURL(server: *ThisServer, req: *uws.Request, resp: *App.Response, url: []const u8) void {
            // We can assume manifest and router exist since this handler is only registered when they do
            const manifest = server.bake_prod.get().?.manifest;
            const router = server.bake_prod.get().?.getRouter();

            // Try to match the request URL against the router
            var params: bun.bake.FrameworkRouter.MatchedParams = undefined;
            if (router.matchSlow(url, &params)) |route_index| {
                // Found a route - check if it's an SSR route
                if (route_index.get() < manifest.routes.len) {
                    const route = &manifest.routes[route_index.get()];
                    switch (route.*) {
                        .ssr => |*ssr| {
                            _ = ssr;
                            // Call the SSR request handler
                            onBakeFrameworkSSRRequest(server, req, resp, route_index, &params);
                            return;
                        },
                        .ssg, .ssg_many => {
                            // This is an SSG route, which should have been handled by static routes
                            // Fall through to the original handler
                        },
                        .empty => {
                            // Empty route, fall through
                        },
                    }
                }
            }

            // No SSR route matched, call the original handler based on config
            switch (server.config.onNodeHTTPRequest) {
                .zero => switch (server.config.onRequest) {
                    .zero => server.on404(req, resp),
                    else => server.onRequest(req, resp),
                },
                else => server.onNodeHTTPRequest(req, resp),
            }
        }

        pub fn onBakeFrameworkSSRRequest(
            server: *ThisServer,
            req: *uws.Request,
            resp: *App.Response,
            route_index: bun.bake.FrameworkRouter.Route.Index,
            params: *const bun.bake.FrameworkRouter.MatchedParams,
        ) void {
            onBakeFrameworkSSRRequestImpl(server, req, resp, route_index, params) catch |err| switch (err) {
                error.JSError => server.vm.global.reportActiveExceptionAsUnhandled(err),
                error.OutOfMemory => bun.outOfMemory(),
            };
        }

        pub fn onBakeFrameworkSSRRequestImpl(
            server: *ThisServer,
            req: *uws.Request,
            resp: *App.Response,
            route_index: bun.bake.FrameworkRouter.Route.Index,
            params: *const bun.bake.FrameworkRouter.MatchedParams,
        ) bun.JSError!void {
            if (comptime Environment.enable_logs)
                httplog("[Bake SSR] {s} - {s}", .{ req.method(), req.url() });

            const bake_prod = server.bake_prod.get().?;
            const server_request_callback = bake_prod.bake_server_runtime_handler.get();
            const global = server.globalThis;
            const args = try bake_prod.newRouteParams(global, route_index, params);

            // Call the server runtime's handleRequest function using onSavedRequest
            server.onSavedRequest(
                .{ .stack = req },
                resp,
                server_request_callback,
                6,
                .{
                    args.route_index,
                    args.router_type_index,
                    args.route_info,
                    args.params,
                    args.newRouteParams,
                    args.setAsyncLocalStorage,
                },
            );
        }

        fn handleSingleSSGRoute(
            server: *ThisServer,
            app: anytype,
            ssg: *bun.bake.Manifest.Route.SSG,
            route_index: usize,
            client_entrypoints_seen: *std.hash_map.HashMap([]const u8, void, bun.StringHashMapContext, 80),
        ) void {
            const global = server.globalThis;
            // const bake_prod = this.bake_prod.get().?;
            const any_server = AnyServer.from(server);

            // For SSG routes with params, we need to build the actual URL path
            // Use the route index to look up the pattern from the framework router
            const url_path =
                server.bake_prod.get().?.reconstructPathFromParams(bun.default_allocator, @intCast(route_index), &ssg.params) catch "/";

            log("Setting URL path: {s}\n", .{url_path});

            // Build the filesystem path to the pre-rendered files
            // SSG files are stored in dist/{route}/index.html and dist/{route}/index.rsc
            var dist_path_buf: [4096]u8 = undefined;
            const dist_path = std.fmt.bufPrint(&dist_path_buf, "dist{s}", .{url_path}) catch bun.outOfMemory();

            // Create file routes for the HTML and RSC files
            // Serve index.html for the main route
            const html_path = bun.default_allocator.alloc(u8, dist_path.len + "/index.html".len) catch bun.outOfMemory();
            @memcpy(html_path[0..dist_path.len], dist_path);
            @memcpy(html_path[dist_path.len..], "/index.html");

            // Create a file blob for the HTML file
            const html_store = jsc.WebCore.Blob.Store.initFile(
                .{ .path = .{ .string = bun.PathString.init(html_path) } },
                bun.http.MimeType.html,
                bun.default_allocator,
            ) catch bun.outOfMemory();

            html_store.ref();
            ssg.store = html_store;

            const html_blob = jsc.WebCore.Blob{
                .size = jsc.WebCore.Blob.max_size,
                .store = html_store,
                .content_type = bun.http.MimeType.html.value,
                .globalThis = global,
            };

            const html_route = FileRoute.initFromBlob(html_blob, .{
                .server = any_server,
                .status_code = 200,
            });

            // Apply the HTML route
            ServerConfig.applyStaticRoute(any_server, Server.ssl_enabled, app, *FileRoute, html_route, url_path, .{ .method = bun.http.Method.Set.init(.{ .GET = true }) });

            // Also serve the .rsc file at the same path with .rsc extension
            const rsc_url_path = bun.default_allocator.alloc(u8, url_path.len + ".rsc".len) catch bun.outOfMemory();
            @memcpy(rsc_url_path[0..url_path.len], url_path);
            @memcpy(rsc_url_path[url_path.len..], ".rsc");

            const rsc_path = bun.default_allocator.alloc(u8, dist_path.len + "/index.rsc".len) catch bun.outOfMemory();
            @memcpy(rsc_path[0..dist_path.len], dist_path);
            @memcpy(rsc_path[dist_path.len..], "/index.rsc");

            // Create a file blob for the RSC file
            const rsc_store = jsc.WebCore.Blob.Store.initFile(
                .{ .path = .{ .string = bun.PathString.init(rsc_path) } },
                bun.http.MimeType.javascript,
                bun.default_allocator,
            ) catch bun.outOfMemory();

            const rsc_blob = jsc.WebCore.Blob{
                .size = jsc.WebCore.Blob.max_size,
                .store = rsc_store,
                .content_type = bun.http.MimeType.javascript.value,
                .globalThis = global,
            };

            const rsc_route = FileRoute.initFromBlob(rsc_blob, .{
                .server = any_server,
                .status_code = 200,
            });

            // Apply the RSC route
            ServerConfig.applyStaticRoute(any_server, Server.ssl_enabled, app, *FileRoute, rsc_route, rsc_url_path, .{ .method = bun.http.Method.Set.init(.{ .GET = true }) });

            // Register the client entrypoint if we haven't already
            if (ssg.entrypoint.len > 0) {
                const result = client_entrypoints_seen.getOrPut(ssg.entrypoint) catch bun.outOfMemory();
                if (!result.found_existing) {
                    // Serve the client JS file (e.g., /_bun/2eeb5qyr.js)
                    // The file is in dist/_bun/xxx.js
                    var client_file_path_buf: [4096]u8 = undefined;
                    const client_file_path = std.fmt.bufPrint(&client_file_path_buf, "dist{s}", .{ssg.entrypoint}) catch bun.outOfMemory();

                    const client_path = bun.default_allocator.dupe(u8, client_file_path) catch bun.outOfMemory();

                    // Create a file blob for the client JS file
                    const client_store = jsc.WebCore.Blob.Store.initFile(
                        .{ .path = .{ .string = bun.PathString.init(client_path) } },
                        bun.http.MimeType.javascript,
                        bun.default_allocator,
                    ) catch bun.outOfMemory();

                    const client_blob = jsc.WebCore.Blob{
                        .size = jsc.WebCore.Blob.max_size,
                        .store = client_store,
                        .content_type = bun.http.MimeType.javascript.value,
                        .globalThis = global,
                    };

                    const client_route = FileRoute.initFromBlob(client_blob, .{
                        .server = any_server,
                        .status_code = 200,
                    });

                    const client_url = bun.default_allocator.dupe(u8, ssg.entrypoint) catch bun.outOfMemory();
                    ServerConfig.applyStaticRoute(any_server, Server.ssl_enabled, app, *FileRoute, client_route, client_url, .{ .method = bun.http.Method.Set.init(.{ .GET = true }) });
                }
            }
        }

        pub fn setBakeManifestRoutes(server: *Server, app: *Server.App, manifest: *bun.bake.Manifest) void {
            // Add route handler for /_bun/* static chunk files
            // FIXME: this is being done dynamically. Either put the _bun/*
            //        files in the manifest or read the directory and make the routes
            //        up front
            app.get("/_bun/*", *Server, server, bakeStaticChunkRequestHandler);

            // First, we need to serve the client entrypoint files
            // These are shared across all SSG routes of the same type
            var client_entrypoints_seen = std.hash_map.HashMap([]const u8, void, bun.StringHashMapContext, 80).init(bun.default_allocator);
            defer client_entrypoints_seen.deinit();

            for (manifest.routes, 0..) |*route, route_index| {
                switch (route.*) {
                    .empty => {},
                    .ssr => {
                        // SSR routes are handled dynamically via bakeProductionSSRRouteHandler
                        // We don't need to set up static routes for SSR
                    },
                    .ssg => |*ssg| {
                        handleSingleSSGRoute(
                            server,
                            app,
                            ssg,
                            route_index,
                            &client_entrypoints_seen,
                        );
                    },
                    .ssg_many => |*ssg_many| {
                        // Handle multiple SSG entries for the same route
                        var iter = ssg_many.iterator();
                        while (iter.next()) |entry| {
                            const ssg = &entry.key_ptr.*;
                            handleSingleSSGRoute(
                                server,
                                app,
                                ssg,
                                route_index,
                                &client_entrypoints_seen,
                            );
                        }
                    },
                }
            }
        }

        pub fn bakeStaticChunkRequestHandler(server: *ThisServer, req: *uws.Request, resp: *App.Response) void {
            const manifest = server.bake_prod.get().?.manifest;

            // Get the asset path from the URL (everything after /_bun/)
            const url = req.url();
            const prefix = "/_bun/";
            if (!std.mem.startsWith(u8, url, prefix)) {
                resp.writeStatus("404 Not Found");
                resp.end("", false);
                return;
            }

            const asset_path = url[prefix.len..];
            if (asset_path.len == 0) {
                resp.writeStatus("404 Not Found");
                resp.end("", false);
                return;
            }

            // Build the full file path: manifest.build_output_dir + "/_bun/" + asset_path
            var file_path_buf: [4096]u8 = undefined;
            const file_path = std.fmt.bufPrint(&file_path_buf, "{s}/_bun/{s}", .{ manifest.build_output_dir, asset_path }) catch {
                resp.writeStatus("500 Internal Server Error");
                resp.end("", false);
                return;
            };

            // Make a copy of the path for the blob to own
            const file_path_copy = bun.default_allocator.dupe(u8, file_path) catch {
                resp.writeStatus("500 Internal Server Error");
                resp.end("", false);
                return;
            };

            // Determine MIME type based on file extension
            const mime_type = if (std.mem.endsWith(u8, asset_path, ".js"))
                bun.http.MimeType.javascript
            else if (std.mem.endsWith(u8, asset_path, ".css"))
                bun.http.MimeType.css
            else if (std.mem.endsWith(u8, asset_path, ".map"))
                bun.http.MimeType.json
            else
                bun.http.MimeType.other;

            // Create a file blob for the static chunk
            const store = jsc.WebCore.Blob.Store.initFile(
                .{ .path = .{ .string = bun.PathString.init(file_path_copy) } },
                mime_type,
                bun.default_allocator,
            ) catch {
                resp.writeStatus("404 Not Found");
                resp.end("", false);
                return;
            };

            const blob = jsc.WebCore.Blob{
                .size = jsc.WebCore.Blob.max_size,
                .store = store,
                .content_type = mime_type.value,
                .globalThis = server.globalThis,
            };

            // Create a file route and serve it
            const any_server = AnyServer.from(server);
            const file_route = FileRoute.initFromBlob(blob, .{
                .server = any_server,
                .status_code = 200,
            });

            // Serve the file using the file route handler
            const any_resp = if (ssl_enabled)
                uws.AnyResponse{ .SSL = resp }
            else
                uws.AnyResponse{ .TCP = resp };
            file_route.onRequest(req, any_resp);
        }
    };
}

const bun = @import("bun");
const bake = bun.bake;
const strings = bun.strings;
const logger = bun.logger;
const Loc = logger.Loc;

const Route = bun.bake.FrameworkRouter.Route;
const SSRRouteList = bun.bake.SSRRouteList;

const jsc = bun.jsc;
const JSError = bun.JSError;
const CallFrame = jsc.CallFrame;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const E = bun.ast.E;

const DirInfo = bun.resolver.DirInfo;
const Resolver = bun.resolver.Resolver;

const mem = std.mem;
const Allocator = mem.Allocator;
const Manifest = bun.bake.Manifest;

const ServerConfig = bun.api.server.ServerConfig;
const AnyServer = bun.api.server.AnyServer;

const Output = bun.Output;
const FileRoute = bun.api.server.FileRoute;
const StaticRoute = bun.api.server.StaticRoute;

const Environment = bun.Environment;

const FrameworkRouter = bun.bake.FrameworkRouter;
const std = @import("std");
const uws = bun.uws;
