// For src/uws_sys/h2.rs. Requests are uWS::Http3Request, so uws_h3_req_* serve HTTP/2 too.

// clang-format off
#include "_libusockets.h"

#include <bun-uws/src/App.h>
#include <bun-uws/src/Http3Request.h>
#include <string_view>
// clang-format on

using uWS::Http2Response;
using uWS::Http3Request;

struct Http2RouterData {
    Http2Response* res;
    Http3Request* req;
};

using Http2Router = uWS::HttpRouter<Http2RouterData>;

extern "C" {

const char* uws_loop_date() { return uWS::Loop::data((us_loop_t*)uWS::Loop::get())->date; }

void uws_app_attach_http2(int ssl, uws_app_t* app, uWS::Http2Context* context, bool allow_http1)
{
    if (ssl)
        ((uWS::TemplatedApp<true>*)app)->attachHttp2(context, allow_http1);
    else
        ((uWS::TemplatedApp<false>*)app)->attachHttp2(context, allow_http1);
}

void uws_h2_socket_on_close(us_socket_t* s)
{
    if (s->ssl)
        uWS::TemplatedApp<true>::onHttp2Close(s);
    else
        uWS::TemplatedApp<false>::onHttp2Close(s);
}

Http2Router* uws_h2_router_create() { return new Http2Router; }
void uws_h2_router_destroy(Http2Router* router) { delete router; }

/* Safe from inside a handler: the route lambda copied what it needs and returns straight after. */
void uws_h2_router_clear(Http2Router* router) { *router = {}; }

__attribute__((noinline)) void uws_h2_router_add(Http2Router* router, const char* method, size_t method_len, const char* pattern, size_t pattern_len,
    void (*handler)(Http2Response*, Http3Request*, void*), void* user_data)
{
    std::string_view methods[] = { { method, method_len } };
    auto route = [handler, user_data](auto* r) {
        auto [res, req] = r->getUserData();
        req->setYield(false);
        req->setParameters(r->getParameters());
        handler(res, req, user_data);
        return !req->getYield();
    };
    router->add(methods, { pattern, pattern_len }, route, methods[0] == "*" ? router->LOW_PRIORITY : router->MEDIUM_PRIORITY);
}

bool uws_h2_router_route(Http2Router* router, Http2Response* res, const us_quic_header_t* headers, unsigned count)
{
    Http3Request req(headers, count);
    router->getUserData() = { res, &req };
    return router->route(req.getMethod(), req.getUrl());
}

} // extern "C"
