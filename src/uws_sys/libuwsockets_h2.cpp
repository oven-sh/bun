// For src/uws_sys/h2.rs.

// clang-format off
#include "_libusockets.h"

#include <bun-uws/src/App.h>
// clang-format on

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

} // extern "C"
