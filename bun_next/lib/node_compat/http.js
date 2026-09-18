const EventEmitter = require('node:events');

class Server extends EventEmitter {
  constructor(handler) {
    super();
    if (handler) this.on('request', handler);
    this.__requests = new Map();
  }

  listen(port, cb) {
    globalThis.__handle_http_request = (req) => {
        const res = {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
            end: (body) => {
                sendToElixir({
                    type: 'http_response',
                    id: req.id,
                    status: res.status,
                    body: body,
                    headers: res.headers
                });
            },
            writeHead: (status, headers) => {
                res.status = status;
                if (headers) {
                    for (let k in headers) res.headers[k] = headers[k];
                }
            }
        };
        this.emit('request', req, res);
    };

    sendToElixir({ type: 'http_server_start', port: port });
    if (cb) setTimeout(cb, 100);
  }
}

module.exports = {
  createServer: (handler) => new Server(handler)
};
