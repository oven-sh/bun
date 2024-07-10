/*
 * Copyright 2022 Ciro Spaciari
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
// clang-format off
#include "libuwebsockets.h"
#include <string_view>
#include "App.h"
#include "ClientApp.h"
#include <optional>
extern "C"
{

    uws_app_t *uws_create_app(int ssl, struct us_bun_socket_context_options_t options)
    {
        if (ssl)
        {
            uWS::SocketContextOptions sco;
            memcpy(&sco, &options, sizeof(uWS::SocketContextOptions));

            return (uws_app_t *)new uWS::SSLApp(sco);
        }

        return (uws_app_t *)new uWS::App();
    }

    void uws_app_get(int ssl, uws_app_t *app, const char *pattern, uws_method_handler handler, void *user_data)
    {
        if (ssl)
        {
            uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
            if (handler == nullptr)
            {
                uwsApp->get(pattern, nullptr);
                return;
            }
            uwsApp->get(pattern, [handler, user_data](auto *res, auto *req)
                        { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
        }
        else
        {
            uWS::App *uwsApp = (uWS::App *)app;
            if (handler == nullptr)
            {
                uwsApp->get(pattern, nullptr);
                return;
            }
            uwsApp->get(pattern, [handler, user_data](auto *res, auto *req)
                        { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
        }
    }
    void uws_app_post(int ssl, uws_app_t *app, const char *pattern, uws_method_handler handler, void *user_data)
    {

        if (ssl)
        {
            uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
            if (handler == nullptr)
            {
                uwsApp->post(pattern, nullptr);
                return;
            }
            uwsApp->post(pattern, [handler, user_data](auto *res, auto *req)
                         { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
        }
        else
        {
            uWS::App *uwsApp = (uWS::App *)app;
            if (handler == nullptr)
            {
                uwsApp->post(pattern, nullptr);
                return;
            }
            uwsApp->post(pattern, [handler, user_data](auto *res, auto *req)
                         { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
        }
    }
    void uws_app_options(int ssl, uws_app_t *app, const char *pattern, uws_method_handler handler, void *user_data)
    {
        if (ssl)
        {
            uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
            if (handler == nullptr)
            {
                uwsApp->options(pattern, nullptr);
                return;
            }
            uwsApp->options(pattern, [handler, user_data](auto *res, auto *req)
                            { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
        }
        else
        {
            uWS::App *uwsApp = (uWS::App *)app;
            if (handler == nullptr)
            {
                uwsApp->options(pattern, nullptr);
                return;
            }
            uwsApp->options(pattern, [handler, user_data](auto *res, auto *req)
                            { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
        }
    }
    void uws_app_delete(int ssl, uws_app_t *app, const char *pattern, uws_method_handler handler, void *user_data)
    {
        if (ssl)
        {
            uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
            if (handler == nullptr)
            {
                uwsApp->del(pattern, nullptr);
                return;
            }
            uwsApp->del(pattern, [handler, user_data](auto *res, auto *req)
                        { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
        }
        else
        {
            uWS::App *uwsApp = (uWS::App *)app;
            if (handler == nullptr)
            {
                uwsApp->del(pattern, nullptr);
                return;
            }
            uwsApp->del(pattern, [handler, user_data](auto *res, auto *req)
                        { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
        }
    }
    void uws_app_patch(int ssl, uws_app_t *app, const char *pattern, uws_method_handler handler, void *user_data)
    {
        if (ssl)
        {
            uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
            if (handler == nullptr)
            {
                uwsApp->patch(pattern, nullptr);
                return;
            }
            uwsApp->patch(pattern, [handler, user_data](auto *res, auto *req)
                          { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
        }
        else
        {
            uWS::App *uwsApp = (uWS::App *)app;
            if (handler == nullptr)
            {
                uwsApp->patch(pattern, nullptr);
                return;
            }
            uwsApp->patch(pattern, [handler, user_data](auto *res, auto *req)
                          { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
        }
    }
    void uws_app_put(int ssl, uws_app_t *app, const char *pattern, uws_method_handler handler, void *user_data)
    {
        if (ssl)
        {
            uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
            if (handler == nullptr)
            {
                uwsApp->put(pattern, nullptr);
                return;
            }
            uwsApp->put(pattern, [handler, user_data](auto *res, auto *req)
                        { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
        }
        else
        {
            uWS::App *uwsApp = (uWS::App *)app;
            if (handler == nullptr)
            {
                uwsApp->put(pattern, nullptr);
                return;
            }
            uwsApp->put(pattern, [handler, user_data](auto *res, auto *req)
                        { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
        }
    }
    void uws_app_head(int ssl, uws_app_t *app, const char *pattern, uws_method_handler handler, void *user_data)
    {
        if (ssl)
        {
            uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
            if (handler == nullptr)
            {
                uwsApp->head(pattern, nullptr);
                return;
            }
            uwsApp->head(pattern, [handler, user_data](auto *res, auto *req)
                         { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
        }
        else
        {
            uWS::App *uwsApp = (uWS::App *)app;
            if (handler == nullptr)
            {
                uwsApp->head(pattern, nullptr);
                return;
            }
            uwsApp->head(pattern, [handler, user_data](auto *res, auto *req)
                         { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
        }
    }
    void uws_app_connect(int ssl, uws_app_t *app, const char *pattern, uws_method_handler handler, void *user_data)
    {
        if (ssl)
        {
            uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
            if (handler == nullptr)
            {
                uwsApp->connect(pattern, nullptr);
                return;
            }
            uwsApp->connect(pattern, [handler, user_data](auto *res, auto *req)
                            { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
        }
        else
        {
            uWS::App *uwsApp = (uWS::App *)app;
            if (handler == nullptr)
            {
                uwsApp->connect(pattern, nullptr);
                return;
            }
            uwsApp->connect(pattern, [handler, user_data](auto *res, auto *req)
                            { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
        }
    }

    void uws_app_trace(int ssl, uws_app_t *app, const char *pattern, uws_method_handler handler, void *user_data)
    {
        if (ssl)
        {
            uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
            if (handler == nullptr)
            {
                uwsApp->trace(pattern, nullptr);
                return;
            }
            uwsApp->trace(pattern, [handler, user_data](auto *res, auto *req)
                          { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
        }
        else
        {
            uWS::App *uwsApp = (uWS::App *)app;
            if (handler == nullptr)
            {
                uwsApp->trace(pattern, nullptr);
                return;
            }
            uwsApp->trace(pattern, [handler, user_data](auto *res, auto *req)
                          { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
        }
    }
    void uws_app_any(int ssl, uws_app_t *app, const char *pattern, uws_method_handler handler, void *user_data)
    {
        if (ssl)
        {
            uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
            if (handler == nullptr)
            {
                uwsApp->any(pattern, nullptr);
                return;
            }
            uwsApp->any(pattern, [handler, user_data](auto *res, auto *req)
                        { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
        }
        else
        {
            uWS::App *uwsApp = (uWS::App *)app;
            if (handler == nullptr)
            {
                uwsApp->any(pattern, nullptr);
                return;
            }
            uwsApp->any(pattern, [handler, user_data](auto *res, auto *req)
                        { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
        }
    }

    void uws_app_run(int ssl, uws_app_t *app)
    {
        if (ssl)
        {
            uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
            uwsApp->run();
        }
        else
        {
            uWS::App *uwsApp = (uWS::App *)app;
            uwsApp->run();
        }
    }

    void uws_app_listen(int ssl, uws_app_t *app, int port, uws_listen_handler handler, void *user_data)
    {
        uws_app_listen_config_t config;
        config.port = port;
        config.host = nullptr;
        config.options = 0;

        if (ssl)
        {
            uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
            uwsApp->listen(port, [handler, config, user_data](struct us_listen_socket_t *listen_socket)
                           { handler((struct us_listen_socket_t *)listen_socket, config, user_data); });
        }
        else
        {
            uWS::App *uwsApp = (uWS::App *)app;

            uwsApp->listen(port, [handler, config, user_data](struct us_listen_socket_t *listen_socket)
                           { handler((struct us_listen_socket_t *)listen_socket, config, user_data); });
        }
    }

    void uws_app_listen_with_config(int ssl, uws_app_t *app, uws_app_listen_config_t config, uws_listen_handler handler, void *user_data)
    {
        if (ssl)
        {
            uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
            uwsApp->listen(config.host, config.port, config.options, [handler, config, user_data](struct us_listen_socket_t *listen_socket)
                           { handler((struct us_listen_socket_t *)listen_socket, config, user_data); });
        }
        else
        {
            uWS::App *uwsApp = (uWS::App *)app;
            uwsApp->listen(config.host, config.port, config.options, [handler, config, user_data](struct us_listen_socket_t *listen_socket)
                           { handler((struct us_listen_socket_t *)listen_socket, config, user_data); });
        }
    }

    /* callback, path to unix domain socket */
    void uws_app_listen_domain(int ssl, uws_app_t *app, const char *domain, size_t domain_length, uws_listen_domain_handler handler, void *user_data)
    {

        if (ssl)
        {
            uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
            uwsApp->listen([handler, domain, domain_length, user_data](struct us_listen_socket_t *listen_socket)
                           { handler((struct us_listen_socket_t *)listen_socket, domain, domain_length, 0, user_data); },
                           std::string(domain, domain_length));
        }
        else
        {
            uWS::App *uwsApp = (uWS::App *)app;

            uwsApp->listen([handler, domain, domain_length, user_data](struct us_listen_socket_t *listen_socket)
                           { handler((struct us_listen_socket_t *)listen_socket, domain, domain_length, 0, user_data); },
                           std::string(domain, domain_length));
        }
    }

    /* callback, path to unix domain socket */
    void uws_app_listen_domain_with_options(int ssl, uws_app_t *app, const char *domain, size_t domain_length, int options, uws_listen_domain_handler handler, void *user_data)
    {

        if (ssl)
        {
            uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
            uwsApp->listen(
                options, [handler, domain, domain_length, options, user_data](struct us_listen_socket_t *listen_socket)
                { handler((struct us_listen_socket_t *)listen_socket, domain, domain_length, options, user_data); },
                std::string(domain, domain_length));
        }
        else
        {
            uWS::App *uwsApp = (uWS::App *)app;

            uwsApp->listen(
                options, [handler, domain, domain_length, options, user_data](struct us_listen_socket_t *listen_socket)
                { handler((struct us_listen_socket_t *)listen_socket, domain, domain_length, options, user_data); },
                std::string(domain, domain_length));
        }
    }
    void uws_app_domain(int ssl, uws_app_t *app, const char *server_name)
    {
        if (ssl)
        {
            uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
            uwsApp->domain(server_name);
        }
        else
        {
            uWS::App *uwsApp = (uWS::App *)app;
            uwsApp->domain(server_name);
        }
    }
    void uws_app_destroy(int ssl, uws_app_t *app)
    {
        if (ssl)
        {
            uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
            delete uwsApp;
        }
        else
        {

            uWS::App *uwsApp = (uWS::App *)app;
            delete uwsApp;
        }
    }

    bool uws_constructor_failed(int ssl, uws_app_t *app)
    {
        if (ssl)
        {
            uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
            if (!uwsApp)
                return true;
            return uwsApp->constructorFailed();
        }
        uWS::App *uwsApp = (uWS::App *)app;
        if (!uwsApp)
            return true;
        return uwsApp->constructorFailed();
    }

    unsigned int uws_num_subscribers(int ssl, uws_app_t *app, const char *topic, size_t topic_length)
    {
        if (ssl)
        {
            uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
            return uwsApp->numSubscribers(std::string_view(topic, topic_length));
        }
        uWS::App *uwsApp = (uWS::App *)app;
        return uwsApp->numSubscribers(std::string_view(topic, topic_length));
    }
    bool uws_publish(int ssl, uws_app_t *app, const char *topic, size_t topic_length, const char *message, size_t message_length, uws_opcode_t opcode, bool compress)
    {
        if (ssl)
        {
            uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
            return uwsApp->publish(std::string_view(topic, topic_length), std::string_view(message, message_length), (uWS::OpCode)(unsigned char)opcode, compress);
        }
        uWS::App *uwsApp = (uWS::App *)app;
        return uwsApp->publish(std::string_view(topic, topic_length), std::string_view(message, message_length), (uWS::OpCode)(unsigned char)opcode, compress);
    }
    void *uws_get_native_handle(int ssl, uws_app_t *app)
    {
        if (ssl)
        {
            uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
            return uwsApp->getNativeHandle();
        }
        uWS::App *uwsApp = (uWS::App *)app;
        return uwsApp->getNativeHandle();
    }
    void uws_remove_server_name(int ssl, uws_app_t *app, const char *hostname_pattern, size_t hostname_pattern_length)
    {
        if (ssl)
        {
            uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
            uwsApp->removeServerName(std::string(hostname_pattern, hostname_pattern_length));
        }
        else
        {
            uWS::App *uwsApp = (uWS::App *)app;
            uwsApp->removeServerName(std::string(hostname_pattern, hostname_pattern_length));
        }
    }
    void uws_add_server_name(int ssl, uws_app_t *app, const char *hostname_pattern, size_t hostname_pattern_length)
    {
        if (ssl)
        {
            uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
            uwsApp->addServerName(std::string(hostname_pattern, hostname_pattern_length));
        }
        else
        {
            uWS::App *uwsApp = (uWS::App *)app;
            uwsApp->addServerName(std::string(hostname_pattern, hostname_pattern_length));
        }
    }
    void uws_add_server_name_with_options(int ssl, uws_app_t *app, const char *hostname_pattern, size_t hostname_pattern_length, struct us_bun_socket_context_options_t options)
    {
        uWS::SocketContextOptions sco;
        memcpy(&sco, &options, sizeof(uWS::SocketContextOptions));

        if (ssl)
        {
            uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
            uwsApp->addServerName(std::string(hostname_pattern, hostname_pattern_length), sco);
        }
        else
        {
            uWS::App *uwsApp = (uWS::App *)app;
            uwsApp->addServerName(std::string(hostname_pattern, hostname_pattern_length), sco);
        }
    }

    void uws_missing_server_name(int ssl, uws_app_t *app, uws_missing_server_handler handler, void *user_data)
    {
        if (ssl)
        {
            uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
            uwsApp->missingServerName([handler, user_data](auto hostname)
                                      { handler(hostname, strlen(hostname), user_data); });
        }
        else
        {
            uWS::App *uwsApp = (uWS::App *)app;
            uwsApp->missingServerName([handler, user_data](auto hostname)
                                      { handler(hostname, strlen(hostname), user_data); });
        }
    }
    void uws_filter(int ssl, uws_app_t *app, uws_filter_handler handler, void *user_data)
    {
        if (ssl)
        {
            uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
            uwsApp->filter([handler, user_data](auto res, auto i)
                           { handler((uws_res_t *)res, i, user_data); });
        }
        else
        {
            uWS::App *uwsApp = (uWS::App *)app;

            uwsApp->filter([handler, user_data](auto res, auto i)
                           { handler((uws_res_t *)res, i, user_data); });
        }
    }

    void uws_ws(int ssl, uws_app_t *app, const char *pattern, uws_socket_behavior_t behavior, void *user_data)
    {
        if (ssl)
        {
            auto generic_handler = uWS::SSLApp::WebSocketBehavior<void *>{
                .compression = (uWS::CompressOptions)(uint64_t)behavior.compression,
                .maxPayloadLength = behavior.maxPayloadLength,
                .idleTimeout = behavior.idleTimeout,
                .maxBackpressure = behavior.maxBackpressure,
                .closeOnBackpressureLimit = behavior.closeOnBackpressureLimit,
                .resetIdleTimeoutOnSend = behavior.resetIdleTimeoutOnSend,
                .sendPingsAutomatically = behavior.sendPingsAutomatically,
                .maxLifetime = behavior.maxLifetime,
            };

            if (behavior.upgrade)
                generic_handler.upgrade = [behavior, user_data](auto *res, auto *req, auto *context)
                {
                    behavior.upgrade((uws_res_t *)res, (uws_req_t *)req, (uws_socket_context_t *)context, user_data);
                };
            if (behavior.open)
                generic_handler.open = [behavior, user_data](auto *ws)
                {
                    behavior.open((uws_websocket_t *)ws, user_data);
                };
            if (behavior.message)
                generic_handler.message = [behavior, user_data](auto *ws, auto message, auto opcode)
                {
                    behavior.message((uws_websocket_t *)ws, message.data(), message.length(), (uws_opcode_t)opcode, user_data);
                };
            if (behavior.drain)
                generic_handler.drain = [behavior, user_data](auto *ws)
                {
                    behavior.drain((uws_websocket_t *)ws, user_data);
                };
            if (behavior.ping)
                generic_handler.ping = [behavior, user_data](auto *ws, auto message)
                {
                    behavior.ping((uws_websocket_t *)ws, message.data(), message.length(), user_data);
                };
            if (behavior.pong)
                generic_handler.pong = [behavior, user_data](auto *ws, auto message)
                {
                    behavior.pong((uws_websocket_t *)ws, message.data(), message.length(), user_data);
                };
            if (behavior.close)
                generic_handler.close = [behavior, user_data](auto *ws, int code, auto message)
                {
                    behavior.close((uws_websocket_t *)ws, code, message.data(), message.length(), user_data);
                };
            if (behavior.subscription)
                generic_handler.subscription = [behavior, user_data](auto *ws, auto topic, int subscribers, int old_subscribers)
                {
                    behavior.subscription((uws_websocket_t *)ws, topic.data(), topic.length(), subscribers, old_subscribers, user_data);
                };
            uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;

            uwsApp->ws<void *>(pattern, std::move(generic_handler));
        }
        else
        {
            auto generic_handler = uWS::App::WebSocketBehavior<void *>{
                .compression = (uWS::CompressOptions)(uint64_t)behavior.compression,
                .maxPayloadLength = behavior.maxPayloadLength,
                .idleTimeout = behavior.idleTimeout,
                .maxBackpressure = behavior.maxBackpressure,
                .closeOnBackpressureLimit = behavior.closeOnBackpressureLimit,
                .resetIdleTimeoutOnSend = behavior.resetIdleTimeoutOnSend,
                .sendPingsAutomatically = behavior.sendPingsAutomatically,
                .maxLifetime = behavior.maxLifetime,
            };

            if (behavior.upgrade)
                generic_handler.upgrade = [behavior, user_data](auto *res, auto *req, auto *context)
                {
                    behavior.upgrade((uws_res_t *)res, (uws_req_t *)req, (uws_socket_context_t *)context, user_data);
                };
            if (behavior.open)
                generic_handler.open = [behavior, user_data](auto *ws)
                {
                    behavior.open((uws_websocket_t *)ws, user_data);
                };
            if (behavior.message)
                generic_handler.message = [behavior, user_data](auto *ws, auto message, auto opcode)
                {
                    behavior.message((uws_websocket_t *)ws, message.data(), message.length(), (uws_opcode_t)opcode, user_data);
                };
            if (behavior.drain)
                generic_handler.drain = [behavior, user_data](auto *ws)
                {
                    behavior.drain((uws_websocket_t *)ws, user_data);
                };
            if (behavior.ping)
                generic_handler.ping = [behavior, user_data](auto *ws, auto message)
                {
                    behavior.ping((uws_websocket_t *)ws, message.data(), message.length(), user_data);
                };
            if (behavior.pong)
                generic_handler.pong = [behavior, user_data](auto *ws, auto message)
                {
                    behavior.pong((uws_websocket_t *)ws, message.data(), message.length(), user_data);
                };
            if (behavior.close)
                generic_handler.close = [behavior, user_data](auto *ws, int code, auto message)
                {
                    behavior.close((uws_websocket_t *)ws, code, message.data(), message.length(), user_data);
                };
            if (behavior.subscription)
                generic_handler.subscription = [behavior, user_data](auto *ws, auto topic, int subscribers, int old_subscribers)
                {
                    behavior.subscription((uws_websocket_t *)ws, topic.data(), topic.length(), subscribers, old_subscribers, user_data);
                };
            uWS::App *uwsApp = (uWS::App *)app;
            uwsApp->ws<void *>(pattern, std::move(generic_handler));
        }
    }

    void *uws_ws_get_user_data(int ssl, uws_websocket_t *ws)
    {
        if (ssl)
        {
            uWS::WebSocket<true, true, void *> *uws = (uWS::WebSocket<true, true, void *> *)ws;
            return *uws->getUserData();
        }
        uWS::WebSocket<false, true, void *> *uws = (uWS::WebSocket<false, true, void *> *)ws;
        return *uws->getUserData();
    }

    void uws_ws_close(int ssl, uws_websocket_t *ws)
    {
        if (ssl)
        {
            uWS::WebSocket<true, true, void *> *uws = (uWS::WebSocket<true, true, void *> *)ws;
            uws->close();
        }
        else
        {
            uWS::WebSocket<false, true, void *> *uws = (uWS::WebSocket<false, true, void *> *)ws;
            uws->close();
        }
    }

    uws_sendstatus_t uws_ws_send(int ssl, uws_websocket_t *ws, const char *message, size_t length, uws_opcode_t opcode)
    {
        if (ssl)
        {
            uWS::WebSocket<true, true, void *> *uws = (uWS::WebSocket<true, true, void *> *)ws;
            return (uws_sendstatus_t)uws->send(std::string_view(message, length), (uWS::OpCode)(unsigned char)opcode);
        }
        uWS::WebSocket<false, true, void *> *uws = (uWS::WebSocket<false, true, void *> *)ws;
        return (uws_sendstatus_t)uws->send(std::string_view(message, length), (uWS::OpCode)(unsigned char)opcode);
    }

    uws_sendstatus_t uws_ws_send_with_options(int ssl, uws_websocket_t *ws, const char *message, size_t length, uws_opcode_t opcode, bool compress, bool fin)
    {
        if (ssl)
        {
            uWS::WebSocket<true, true, void *> *uws = (uWS::WebSocket<true, true, void *> *)ws;
            return (uws_sendstatus_t)uws->send(std::string_view(message, length), (uWS::OpCode)(unsigned char)opcode, compress, fin);
        }
        uWS::WebSocket<false, true, void *> *uws = (uWS::WebSocket<false, true, void *> *)ws;
        return (uws_sendstatus_t)uws->send(std::string_view(message, length), (uWS::OpCode)(unsigned char)opcode, compress, fin);
    }

    uws_sendstatus_t uws_ws_send_fragment(int ssl, uws_websocket_t *ws, const char *message, size_t length, bool compress)
    {
        if (ssl)
        {
            uWS::WebSocket<true, true, void *> *uws = (uWS::WebSocket<true, true, void *> *)ws;
            return (uws_sendstatus_t)uws->sendFragment(std::string_view(message, length), compress);
        }
        uWS::WebSocket<false, true, void *> *uws = (uWS::WebSocket<false, true, void *> *)ws;
        return (uws_sendstatus_t)uws->sendFragment(std::string_view(message, length), compress);
    }
    uws_sendstatus_t uws_ws_send_first_fragment(int ssl, uws_websocket_t *ws, const char *message, size_t length, bool compress)
    {
        if (ssl)
        {
            uWS::WebSocket<true, true, void *> *uws = (uWS::WebSocket<true, true, void *> *)ws;
            return (uws_sendstatus_t)uws->sendFirstFragment(std::string_view(message, length), uWS::OpCode::BINARY, compress);
        }
        uWS::WebSocket<false, true, void *> *uws = (uWS::WebSocket<false, true, void *> *)ws;
        return (uws_sendstatus_t)uws->sendFirstFragment(std::string_view(message, length), uWS::OpCode::BINARY, compress);
    }
    uws_sendstatus_t uws_ws_send_first_fragment_with_opcode(int ssl, uws_websocket_t *ws, const char *message, size_t length, uws_opcode_t opcode, bool compress)
    {
        if (ssl)
        {
            uWS::WebSocket<true, true, void *> *uws = (uWS::WebSocket<true, true, void *> *)ws;
            return (uws_sendstatus_t)uws->sendFirstFragment(std::string_view(message, length), (uWS::OpCode)(unsigned char)opcode, compress);
        }
        uWS::WebSocket<false, true, void *> *uws = (uWS::WebSocket<false, true, void *> *)ws;
        return (uws_sendstatus_t)uws->sendFirstFragment(std::string_view(message, length), (uWS::OpCode)(unsigned char)opcode, compress);
    }
    uws_sendstatus_t uws_ws_send_last_fragment(int ssl, uws_websocket_t *ws, const char *message, size_t length, bool compress)
    {
        if (ssl)
        {
            uWS::WebSocket<true, true, void *> *uws = (uWS::WebSocket<true, true, void *> *)ws;
            return (uws_sendstatus_t)uws->sendLastFragment(std::string_view(message, length), compress);
        }
        uWS::WebSocket<false, true, void *> *uws = (uWS::WebSocket<false, true, void *> *)ws;
        return (uws_sendstatus_t)uws->sendLastFragment(std::string_view(message, length), compress);
    }

    void uws_ws_end(int ssl, uws_websocket_t *ws, int code, const char *message, size_t length)
    {
        if (ssl)
        {
            uWS::WebSocket<true, true, void *> *uws = (uWS::WebSocket<true, true, void *> *)ws;
            uws->end(code, std::string_view(message, length));
        }
        else
        {
            uWS::WebSocket<false, true, void *> *uws = (uWS::WebSocket<false, true, void *> *)ws;
            uws->end(code, std::string_view(message, length));
        }
    }

    void uws_ws_cork(int ssl, uws_websocket_t *ws, void (*handler)(void *user_data), void *user_data)
    {
        if (ssl)
        {
            uWS::WebSocket<true, true, void *> *uws = (uWS::WebSocket<true, true, void *> *)ws;
            uws->cork([handler, user_data]()
                      { handler(user_data); });
        }
        else
        {
            uWS::WebSocket<false, true, void *> *uws = (uWS::WebSocket<false, true, void *> *)ws;

            uws->cork([handler, user_data]()
                      { handler(user_data); });
        }
    }
    bool uws_ws_subscribe(int ssl, uws_websocket_t *ws, const char *topic, size_t length)
    {
        if (ssl)
        {
            uWS::WebSocket<true, true, void *> *uws = (uWS::WebSocket<true, true, void *> *)ws;
            return uws->subscribe(std::string_view(topic, length));
        }
        uWS::WebSocket<false, true, void *> *uws = (uWS::WebSocket<false, true, void *> *)ws;
        return uws->subscribe(std::string_view(topic, length));
    }
    bool uws_ws_unsubscribe(int ssl, uws_websocket_t *ws, const char *topic, size_t length)
    {
        if (ssl)
        {
            uWS::WebSocket<true, true, void *> *uws = (uWS::WebSocket<true, true, void *> *)ws;
            return uws->unsubscribe(std::string_view(topic, length));
        }
        uWS::WebSocket<false, true, void *> *uws = (uWS::WebSocket<false, true, void *> *)ws;
        return uws->unsubscribe(std::string_view(topic, length));
    }

    bool uws_ws_is_subscribed(int ssl, uws_websocket_t *ws, const char *topic, size_t length)
    {
        if (ssl)
        {
            uWS::WebSocket<true, true, void *> *uws = (uWS::WebSocket<true, true, void *> *)ws;
            return uws->isSubscribed(std::string_view(topic, length));
        }
        uWS::WebSocket<false, true, void *> *uws = (uWS::WebSocket<false, true, void *> *)ws;
        return uws->isSubscribed(std::string_view(topic, length));
    }
    void uws_ws_iterate_topics(int ssl, uws_websocket_t *ws, void (*callback)(const char *topic, size_t length, void *user_data), void *user_data)
    {
        if (ssl)
        {
            uWS::WebSocket<true, true, void *> *uws = (uWS::WebSocket<true, true, void *> *)ws;
            uws->iterateTopics([callback, user_data](auto topic)
                               { callback(topic.data(), topic.length(), user_data); });
        }
        else
        {
            uWS::WebSocket<false, true, void *> *uws = (uWS::WebSocket<false, true, void *> *)ws;

            uws->iterateTopics([callback, user_data](auto topic)
                               { callback(topic.data(), topic.length(), user_data); });
        }
    }

    bool uws_ws_publish(int ssl, uws_websocket_t *ws, const char *topic, size_t topic_length, const char *message, size_t message_length)
    {
        if (ssl)
        {
            uWS::WebSocket<true, true, void *> *uws = (uWS::WebSocket<true, true, void *> *)ws;
            return uws->publish(std::string_view(topic, topic_length), std::string_view(message, message_length));
        }
        uWS::WebSocket<false, true, void *> *uws = (uWS::WebSocket<false, true, void *> *)ws;
        return uws->publish(std::string_view(topic, topic_length), std::string_view(message, message_length));
    }

    bool uws_ws_publish_with_options(int ssl, uws_websocket_t *ws, const char *topic, size_t topic_length, const char *message, size_t message_length, uws_opcode_t opcode, bool compress)
    {
        if (ssl)
        {
            uWS::WebSocket<true, true, void *> *uws = (uWS::WebSocket<true, true, void *> *)ws;
            return uws->publish(std::string_view(topic, topic_length), std::string_view(message, message_length), (uWS::OpCode)(unsigned char)opcode, compress);
        }
        uWS::WebSocket<false, true, void *> *uws = (uWS::WebSocket<false, true, void *> *)ws;
        return uws->publish(std::string_view(topic, topic_length), std::string_view(message, message_length), (uWS::OpCode)(unsigned char)opcode, compress);
    }

    unsigned int uws_ws_get_buffered_amount(int ssl, uws_websocket_t *ws)
    {
        if (ssl)
        {
            uWS::WebSocket<true, true, void *> *uws = (uWS::WebSocket<true, true, void *> *)ws;
            return uws->getBufferedAmount();
        }
        uWS::WebSocket<false, true, void *> *uws = (uWS::WebSocket<false, true, void *> *)ws;
        return uws->getBufferedAmount();
    }

    size_t uws_ws_get_remote_address(int ssl, uws_websocket_t *ws, const char **dest)
    {
        if (ssl)
        {
            uWS::WebSocket<true, true, void *> *uws = (uWS::WebSocket<true, true, void *> *)ws;
            std::string_view value = uws->getRemoteAddress();
            *dest = value.data();
            return value.length();
        }
        uWS::WebSocket<false, true, void *> *uws = (uWS::WebSocket<false, true, void *> *)ws;

        std::string_view value = uws->getRemoteAddress();
        *dest = value.data();
        return value.length();
    }

    size_t uws_ws_get_remote_address_as_text(int ssl, uws_websocket_t *ws, const char **dest)
    {
        if (ssl)
        {
            uWS::WebSocket<true, true, void *> *uws = (uWS::WebSocket<true, true, void *> *)ws;

            std::string_view value = uws->getRemoteAddressAsText();
            *dest = value.data();
            return value.length();
        }
        uWS::WebSocket<false, true, void *> *uws = (uWS::WebSocket<false, true, void *> *)ws;

        std::string_view value = uws->getRemoteAddressAsText();
        *dest = value.data();
        return value.length();
    }
    void uws_res_close(int ssl, uws_res_t *res)
    {
        if (ssl)
        {
            uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
            uwsRes->close();
        }
        else
        {
            uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
            uwsRes->close();
        }
    }
    void uws_res_end(int ssl, uws_res_t *res, const char *data, size_t length, bool close_connection)
    {
        if (ssl)
        {
            uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
            uwsRes->end(std::string_view(data, length), close_connection);
        }
        else
        {
            uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
            uwsRes->end(std::string_view(data, length), close_connection);
        }
    }

    size_t uws_res_get_remote_address(int ssl, uws_res_t *res, const char **dest)
    {
        if (ssl)
        {
            uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
            std::string_view value = uwsRes->getRemoteAddress();
            *dest = value.data();
            return value.length();
        }
        uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;

        std::string_view value = uwsRes->getRemoteAddress();
        *dest = value.data();
        return value.length();
    }

    size_t uws_res_get_remote_address_as_text(int ssl, uws_res_t *res, const char **dest)
    {
        if (ssl)
        {
            uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
            std::string_view value = uwsRes->getRemoteAddressAsText();
            *dest = value.data();
            return value.length();
        }
        uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;

        std::string_view value = uwsRes->getRemoteAddressAsText();
        *dest = value.data();
        return value.length();
    }
#ifdef UWS_WITH_PROXY
    size_t uws_res_get_proxied_remote_address(int ssl, uws_res_t *res, const char **dest)
    {
        if (ssl)
        {
            uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
            std::string_view value = uwsRes->getProxiedRemoteAddress();
            *dest = value.data();
            return value.length();
        }
        uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;

        std::string_view value = uwsRes->getProxiedRemoteAddress();
        *dest = value.data();
        return value.length();
    }

    size_t uws_res_get_proxied_remote_address_as_text(int ssl, uws_res_t *res, const char **dest)
    {
        if (ssl)
        {
            uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
            std::string_view value = uwsRes->getProxiedRemoteAddressAsText();
            *dest = value.data();
            return value.length();
        }
        uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;

        std::string_view value = uwsRes->getProxiedRemoteAddressAsText();
        *dest = value.data();
        return value.length();
    }
#endif
    uws_try_end_result_t uws_res_try_end(int ssl, uws_res_t *res, const char *data, size_t length, uint64_t total_size, bool close_connection)
    {
        if (ssl)
        {
            uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
            // uwsRes->end(std::string_view(data, length), close_connection);
            std::pair<bool, bool> result = uwsRes->tryEnd(std::string_view(data, length), total_size, close_connection);
            return uws_try_end_result_t{
                .ok = result.first,
                .has_responded = result.second,
            };
        }
        else
        {
            uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
            std::pair<bool, bool> result = uwsRes->tryEnd(std::string_view(data, length), total_size);
            return uws_try_end_result_t{
                .ok = result.first,
                .has_responded = result.second,
            };
        }
    }

    void uws_res_cork(int ssl, uws_res_t *res, void (*callback)(uws_res_t *res, void *user_data), void *user_data)
    {
        if (ssl)
        {
            uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
            uwsRes->cork([=]()
                         { callback(res, user_data); });
        }
        else
        {
            uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
            uwsRes->cork([=]()
                         { callback(res, user_data); });
        }
    }

    void uws_res_pause(int ssl, uws_res_t *res)
    {
        if (ssl)
        {
            uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
            uwsRes->pause();
        }
        else
        {
            uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
            uwsRes->pause();
        }
    }

    void uws_res_resume(int ssl, uws_res_t *res)
    {
        if (ssl)
        {
            uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
            uwsRes->pause();
        }
        else
        {
            uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
            uwsRes->pause();
        }
    }

    void uws_res_write_continue(int ssl, uws_res_t *res)
    {
        if (ssl)
        {
            uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
            uwsRes->writeContinue();
        }
        else
        {
            uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
            uwsRes->writeContinue();
        }
    }

    void uws_res_write_status(int ssl, uws_res_t *res, const char *status, size_t length)
    {
        if (ssl)
        {
            uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
            uwsRes->writeStatus(std::string_view(status, length));
        }
        else
        {
            uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
            uwsRes->writeStatus(std::string_view(status, length));
        }
    }

    void uws_res_write_header(int ssl, uws_res_t *res, const char *key, size_t key_length, const char *value, size_t value_length)
    {
        if (ssl)
        {
            uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
            uwsRes->writeHeader(std::string_view(key, key_length), std::string_view(value, value_length));
        }
        else
        {
            uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
            uwsRes->writeHeader(std::string_view(key, key_length), std::string_view(value, value_length));
        }
    }
    void uws_res_write_header_int(int ssl, uws_res_t *res, const char *key, size_t key_length, uint64_t value)
    {
        if (ssl)
        {
            uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
            uwsRes->writeHeader(std::string_view(key, key_length), value);
        }
        else
        {

            uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
            uwsRes->writeHeader(std::string_view(key, key_length), value);
        }
    }

    void uws_res_end_without_body(int ssl, uws_res_t *res, bool close_connection)
    {
        if (ssl)
        {
            uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
            uwsRes->endWithoutBody(std::nullopt, close_connection);
        }
        else
        {
            uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
            uwsRes->endWithoutBody(std::nullopt, close_connection);
        }
    }

    bool uws_res_write(int ssl, uws_res_t *res, const char *data, size_t length)
    {
        if (ssl)
        {
            uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
            return uwsRes->write(std::string_view(data, length));
        }
        uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
        return uwsRes->write(std::string_view(data, length));
    }
    uint64_t uws_res_get_write_offset(int ssl, uws_res_t *res)
    {
        if (ssl)
        {
            uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
            return uwsRes->getWriteOffset();
        }
        uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
        return uwsRes->getWriteOffset();
    }
    void uws_res_override_write_offset(int ssl, uws_res_t *res, uint64_t offset)
    {
        if (ssl)
        {
            uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
            uwsRes->overrideWriteOffset(offset);
        }
        else
        {
            uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
            uwsRes->overrideWriteOffset(offset);
        }
    }
    bool uws_res_has_responded(int ssl, uws_res_t *res)
    {
        if (ssl)
        {
            uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
            return uwsRes->hasResponded();
        }
        uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
        return uwsRes->hasResponded();
    }

    void uws_res_on_writable(int ssl, uws_res_t *res, bool (*handler)(uws_res_t *res, uint64_t, void *optional_data), void *optional_data)
    {
        if (ssl)
        {
            uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
            uwsRes->onWritable([handler, res, optional_data](uint64_t a)
                               { return handler(res, a, optional_data); });
        }
        else
        {
            uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
            uwsRes->onWritable([handler, res, optional_data](uint64_t a)
                               { return handler(res, a, optional_data); });
        }
    }

    void uws_res_on_aborted(int ssl, uws_res_t *res, void (*handler)(uws_res_t *res, void *optional_data), void *optional_data)
    {
        if (ssl)
        {
            uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
            uwsRes->onAborted([handler, res, optional_data]
                              { handler(res, optional_data); });
        }
        else
        {
            uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
            uwsRes->onAborted([handler, res, optional_data]
                              { handler(res, optional_data); });
        }
    }

    void uws_res_on_data(int ssl, uws_res_t *res, void (*handler)(uws_res_t *res, const char *chunk, size_t chunk_length, bool is_end, void *optional_data), void *optional_data)
    {
        if (ssl)
        {
            uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
            uwsRes->onData([handler, res, optional_data](auto chunk, bool is_end)
                           { handler(res, chunk.data(), chunk.length(), is_end, optional_data); });
        }
        else
        {
            uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
            uwsRes->onData([handler, res, optional_data](auto chunk, bool is_end)
                           { handler(res, chunk.data(), chunk.length(), is_end, optional_data); });
        }
    }

    bool uws_req_is_ancient(uws_req_t *res)
    {
        uWS::HttpRequest *uwsReq = (uWS::HttpRequest *)res;
        return uwsReq->isAncient();
    }

    bool uws_req_get_yield(uws_req_t *res)
    {
        uWS::HttpRequest *uwsReq = (uWS::HttpRequest *)res;
        return uwsReq->getYield();
    }

    void uws_req_set_yield(uws_req_t *res, bool yield)
    {
        uWS::HttpRequest *uwsReq = (uWS::HttpRequest *)res;
        return uwsReq->setYield(yield);
    }

    size_t uws_req_get_url(uws_req_t *res, const char **dest)
    {
        uWS::HttpRequest *uwsReq = (uWS::HttpRequest *)res;
        std::string_view value = uwsReq->getUrl();
        *dest = value.data();
        return value.length();
    }

    size_t uws_req_get_full_url(uws_req_t *res, const char **dest)
    {
        uWS::HttpRequest *uwsReq = (uWS::HttpRequest *)res;
        std::string_view value = uwsReq->getFullUrl();
        *dest = value.data();
        return value.length();
    }

    size_t uws_req_get_method(uws_req_t *res, const char **dest)
    {
        uWS::HttpRequest *uwsReq = (uWS::HttpRequest *)res;
        std::string_view value = uwsReq->getMethod();
        *dest = value.data();
        return value.length();
    }

    size_t uws_req_get_case_sensitive_method(uws_req_t *res, const char **dest)
    {
        uWS::HttpRequest *uwsReq = (uWS::HttpRequest *)res;
        std::string_view value = uwsReq->getCaseSensitiveMethod();
        *dest = value.data();
        return value.length();
    }

    void uws_req_for_each_header(uws_req_t *res, uws_get_headers_server_handler handler, void *user_data)
    {
        uWS::HttpRequest *uwsReq = (uWS::HttpRequest *)res;
        for (auto header : *uwsReq)
        {
            handler(header.first.data(), header.first.length(), header.second.data(), header.second.length(), user_data);
        }
    }

    size_t uws_req_get_header(uws_req_t *res, const char *lower_case_header, size_t lower_case_header_length, const char **dest)
    {
        uWS::HttpRequest *uwsReq = (uWS::HttpRequest *)res;

        std::string_view value = uwsReq->getHeader(std::string_view(lower_case_header, lower_case_header_length));
        *dest = value.data();
        return value.length();
    }

    size_t uws_req_get_query(uws_req_t *res, const char *key, size_t key_length, const char **dest)
    {
        uWS::HttpRequest *uwsReq = (uWS::HttpRequest *)res;

        std::string_view value = uwsReq->getQuery(std::string_view(key, key_length));
        *dest = value.data();
        return value.length();
    }

    size_t uws_req_get_parameter(uws_req_t *res, unsigned short index, const char **dest)
    {
        uWS::HttpRequest *uwsReq = (uWS::HttpRequest *)res;
        std::string_view value = uwsReq->getParameter(index);
        *dest = value.data();
        return value.length();
    }

    void uws_res_upgrade(int ssl, uws_res_t *res, void *data, const char *sec_web_socket_key, size_t sec_web_socket_key_length, const char *sec_web_socket_protocol, size_t sec_web_socket_protocol_length, const char *sec_web_socket_extensions, size_t sec_web_socket_extensions_length, uws_socket_context_t *ws)
    {

        if (ssl)
        {
            uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;

            uwsRes->template upgrade<void *>(data ? std::move(data) : NULL,
                                             std::string_view(sec_web_socket_key, sec_web_socket_key_length),
                                             std::string_view(sec_web_socket_protocol, sec_web_socket_protocol_length),
                                             std::string_view(sec_web_socket_extensions, sec_web_socket_extensions_length),
                                             (struct us_socket_context_t *)ws);
        }
        else
        {
            uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;

            uwsRes->template upgrade<void *>(data ? std::move(data) : NULL,
                                             std::string_view(sec_web_socket_key, sec_web_socket_key_length),
                                             std::string_view(sec_web_socket_protocol, sec_web_socket_protocol_length),
                                             std::string_view(sec_web_socket_extensions, sec_web_socket_extensions_length),
                                             (struct us_socket_context_t *)ws);
        }
    }

    void *uws_res_get_native_handle(int ssl, uws_res_t *res)
    {
        if (ssl)
        {
            uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
            return uwsRes->getNativeHandle();
        }
        else
        {
            uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
            return uwsRes->getNativeHandle();
        }
    }

    struct us_loop_t *uws_get_loop()
    {
        return (struct us_loop_t *)uWS::Loop::get();
    }

    struct us_loop_t *uws_get_loop_with_native(void *existing_native_loop)
    {
        return (struct us_loop_t *)uWS::Loop::get(existing_native_loop);
    }
    void uws_loop_defer(us_loop_t *loop, void( cb(void *user_data) ), void *user_data)
    {
        uWS::Loop *loop_instance = (uWS::Loop *)loop;
        loop_instance->defer([cb, user_data](){
            cb(user_data);
        });

    }
}
