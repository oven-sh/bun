import type { IncomingMessage, ServerResponse } from 'node:http';
import { splitCookiesString } from 'set-cookie-parser';

// Convert node:http Request/Response objects to/from their web equivalents
// Credits to the SvelteKit team (Modified)
// https://github.com/sveltejs/kit/blob/8d1ba04825a540324bc003e85f36559a594aadc2/packages/kit/src/exports/node/index.js

export const requestNodeResSymbol = Symbol('bun-polyfills.serve.nodeReq');
export const requestRemoteIPSymbol = Symbol('bun-polyfills.serve.remoteIP');
export const toWebRequest = (nodeReq: IncomingMessage, nodeRes: ServerResponse, bodySizeLimit?: number): Request => {
    const webReq = new Request('http://' + nodeReq.headers.host! + nodeReq.url, {
        duplex: 'half',
        method: nodeReq.method,
        headers: nodeReq.headers as Record<string, string>,
        body: getRawBody(nodeReq, bodySizeLimit),
    });
    Reflect.set(webReq, requestRemoteIPSymbol, {
        address: nodeReq.socket.remoteAddress, port: nodeReq.socket.remotePort, family: nodeReq.socket.remoteFamily,
    });
    Reflect.set(webReq, requestNodeResSymbol, nodeRes);
    return webReq;
}

export const sendWebResponse = (nodeRes: ServerResponse, webRes: Response): void => {
    const headers = Object.fromEntries(webRes.headers);
    const cookies: string[] = webRes.headers.has('set-cookie') ? splitCookiesString(webRes.headers.get('set-cookie')!) : [];
    try {
        nodeRes.writeHead(webRes.status, { ...headers, 'set-cookie': cookies });
    } catch {
        // Headers already modified, assume this is an upgraded request
    }

    if (!webRes.body) return void nodeRes.end();
    if (webRes.body.locked) {
        nodeRes.write(
            'Fatal error: Response body is locked. ' +
            `This can happen when the response was already read (for example through 'response.json()' or 'response.text()').`
        );
        return void nodeRes.end();
    }

    const reader = webRes.body.getReader();
    if (nodeRes.destroyed) return void reader.cancel();

    const cancel = (error?: Error) => {
        nodeRes.off('close', cancel);
        nodeRes.off('error', cancel);
        // If the reader has already been interrupted with an error earlier,
        // then it will appear here, it is useless, but it needs to be caught.
        reader.cancel(error).catch(() => {});
        if (error) nodeRes.destroy(error);
    };
    nodeRes.on('close', cancel);
    nodeRes.on('error', cancel);

    next();
    async function next() {
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (!nodeRes.write(value)) return void nodeRes.once('drain', next);
            }
            nodeRes.end();
        } catch (error) {
            cancel(error instanceof Error ? error : new Error(String(error)));
        }
    }
}

class HTTPError extends Error {
    constructor(status: number, reason: string) {
        super(reason);
        this.status = status;
    }
    status: number;
    get reason() { return super.message; }
}

function getRawBody(req: IncomingMessage, bodySizeLimit?: number): ReadableStream | null {
    const h = req.headers;
    if (!h['content-type']) return null;
    const contentLength = Number(h['content-length']);
    // check if no request body
    if ((req.httpVersionMajor === 1 && isNaN(contentLength) && h['transfer-encoding'] == null) || contentLength === 0) return null;

    let length = contentLength;
    if (bodySizeLimit) {
        if (!length) length = bodySizeLimit;
        else if (length > bodySizeLimit) throw new HTTPError(413, `Received content-length of ${length}, but only accept up to ${bodySizeLimit} bytes.`);
    }

    if (req.destroyed) {
        const readable = new ReadableStream();
        return readable.cancel(), readable;
    }

    let size = 0;
    let cancelled = false;
    return new ReadableStream({
        start(controller) {
            req.on('error', (error) => (cancelled = true, controller.error(error)));
            req.on('end', () => cancelled || controller.close());
            req.on('data', (chunk) => {
                if (cancelled) return;

                size += chunk.length;
                if (size > length) return cancelled = true, controller.error(
                    new HTTPError(413, `request body size exceeded ${contentLength ? "'content-length'" : 'BODY_SIZE_LIMIT'} of ${length}`)
                );
                controller.enqueue(chunk);
                if (controller.desiredSize === null || controller.desiredSize <= 0) req.pause();
            });
        },
        pull() { req.resume(); },
        cancel(reason) { cancelled = true, req.destroy(reason); },
    });
}
