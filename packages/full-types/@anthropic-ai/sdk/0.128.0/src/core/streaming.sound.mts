var _Stream_client: WeakMap<object, Client>;
import { __classPrivateFieldGet, __classPrivateFieldSet } from "../internal/tslib.mjs";
import { AnthropicError } from "./error.mjs";
import { makeReadableStream } from "../internal/shims.mjs";
import { findDoubleNewlineIndex, LineDecoder } from "../internal/decoders/line.mjs";
import { ReadableStreamToAsyncIterable } from "../internal/shims.mjs";
import { isAbortError } from "../internal/errors.mjs";
import { safeJSON } from "../internal/utils/values.mjs";
import { encodeUTF8 } from "../internal/utils/bytes.mjs";
import { loggerFor } from "../internal/utils/log.mjs";
import { APIError } from "./error.mjs";
import { releaseRequestSignal } from "../internal/request-signal.mjs";
export var Stream = /* @__PURE__ */ (() => {
    class Stream<Item> { /*$*/declare iterator: () => AsyncIterator<Item>; declare controller: AbortController;/*$*/
        constructor(iterator: () => AsyncIterator<Item>, controller: AbortController, client?: Client) {
            this.iterator = iterator;
            _Stream_client.set(this, void 0);
            this.controller = controller;
            __classPrivateFieldSet(this, _Stream_client, client, "f");
        }
        /**
         * Iterate the raw Server-Sent Events from `response` — `{event, data, raw}`
         * objects, before any JSON parsing or event-name filtering.
         *
         * This reads `response.body` directly (not a clone), so the response is
         * consumed. Use this in middleware that fully replaces the stream body; for
         * read-only observation of parsed events, use `ctx.parse()` instead.
         */
        static rawEvents(response: Response, controller: AbortController = new AbortController()): AsyncGenerator<ServerSentEvent, void, unknown> {
            return _iterSSEMessages(response, controller);
        }
        static fromSSEResponse<Item>(response: Response, controller: AbortController, client?: Client): Stream<Item> {
            let consumed = false;
            const logger: Logger = client ? loggerFor(client) : console;
            async function* iterator(): AsyncIterator<Item, any, undefined> {
                if (consumed) {
                    throw new AnthropicError('Cannot iterate over a consumed stream, use `.tee()` to split the stream.');
                }
                consumed = true;
                let done = false;
                try {
                    for await (const sse of _iterSSEMessages(response, controller)) {
                        if (sse.event === 'completion') {
                            try {
                                yield JSON.parse(sse.data);
                            }
                            catch (e) {
                                logger.error(`Could not parse message into JSON:`, sse.data);
                                logger.error(`From chunk:`, sse.raw);
                                throw e;
                            }
                        }
                        if (sse.event === 'message_start' ||
                            sse.event === 'message_delta' ||
                            sse.event === 'message_stop' ||
                            sse.event === 'content_block_start' ||
                            sse.event === 'content_block_delta' ||
                            sse.event === 'content_block_stop' ||
                            sse.event === 'message' ||
                            sse.event === 'user.message' ||
                            sse.event === 'user.interrupt' ||
                            sse.event === 'user.tool_confirmation' ||
                            sse.event === 'user.custom_tool_result' ||
                            sse.event === 'user.tool_result' ||
                            sse.event === 'agent.message' ||
                            sse.event === 'agent.thinking' ||
                            sse.event === 'agent.tool_use' ||
                            sse.event === 'agent.tool_result' ||
                            sse.event === 'agent.mcp_tool_use' ||
                            sse.event === 'agent.mcp_tool_result' ||
                            sse.event === 'agent.custom_tool_use' ||
                            sse.event === 'agent.thread_context_compacted' ||
                            sse.event === 'session.status_running' ||
                            sse.event === 'session.status_idle' ||
                            sse.event === 'session.status_rescheduled' ||
                            sse.event === 'session.status_terminated' ||
                            sse.event === 'session.error' ||
                            sse.event === 'session.deleted' ||
                            sse.event === 'session.updated' ||
                            sse.event === 'span.model_request_start' ||
                            sse.event === 'span.model_request_end' ||
                            sse.event === 'span.outcome_evaluation_start' ||
                            sse.event === 'span.outcome_evaluation_ongoing' ||
                            sse.event === 'span.outcome_evaluation_end' ||
                            sse.event === 'user.define_outcome' ||
                            sse.event === 'agent.thread_message_received' ||
                            sse.event === 'agent.thread_message_sent' ||
                            sse.event === 'agent.session_thread_message_received' ||
                            sse.event === 'agent.session_thread_message_sent' ||
                            sse.event === 'session.thread_created' ||
                            sse.event === 'session.thread_status_created' ||
                            sse.event === 'session.thread_status_running' ||
                            sse.event === 'session.thread_status_idle' ||
                            sse.event === 'session.thread_status_rescheduled' ||
                            sse.event === 'session.thread_status_terminated' ||
                            sse.event === 'event_start' ||
                            sse.event === 'event_delta' ||
                            sse.event === 'system.message') {
                            try {
                                yield JSON.parse(sse.data);
                            }
                            catch (e) {
                                logger.error(`Could not parse message into JSON:`, sse.data);
                                logger.error(`From chunk:`, sse.raw);
                                throw e;
                            }
                        }
                        if (sse.event === 'ping') {
                            continue;
                        }
                        if (sse.event === 'error') {
                            const body = safeJSON(sse.data) ?? sse.data;
                            const type = body?.error?.type;
                            throw new APIError(undefined, body, undefined, response.headers, type);
                        }
                    }
                    done = true;
                }
                catch (e) {
                    // If the user calls `stream.controller.abort()`, we should exit without throwing.
                    if (isAbortError(e))
                        return;
                    throw e;
                }
                finally {
                    // If the user `break`s, abort the ongoing request.
                    if (!done)
                        controller.abort();
                    releaseRequestSignal(controller);
                }
            }
            return new Stream(iterator, controller, client);
        }
        /**
         * Generates a Stream from a newline-separated ReadableStream
         * where each item is a JSON value.
         */
        static fromReadableStream<Item>(readableStream: GivenStream, controller: AbortController, client?: Client): Stream<Item> {
            let consumed = false;
            async function* iterLines(): AsyncGenerator<string, void, unknown> {
                const lineDecoder = new LineDecoder();
                const iter = ReadableStreamToAsyncIterable<Bytes>(readableStream);
                for await (const chunk of iter) {
                    for (const line of lineDecoder.decode(chunk)) {
                        yield line;
                    }
                }
                for (const line of lineDecoder.flush()) {
                    yield line;
                }
            }
            async function* iterator(): AsyncIterator<Item, any, undefined> {
                if (consumed) {
                    throw new AnthropicError('Cannot iterate over a consumed stream, use `.tee()` to split the stream.');
                }
                consumed = true;
                let done = false;
                try {
                    for await (const line of iterLines()) {
                        if (done)
                            continue;
                        if (line)
                            yield JSON.parse(line);
                    }
                    done = true;
                }
                catch (e) {
                    // If the user calls `stream.controller.abort()`, we should exit without throwing.
                    if (isAbortError(e))
                        return;
                    throw e;
                }
                finally {
                    // If the user `break`s, abort the ongoing request.
                    if (!done)
                        controller.abort();
                    releaseRequestSignal(controller);
                }
            }
            return new Stream(iterator, controller, client);
        }
        [(_Stream_client = new WeakMap(), Symbol.asyncIterator)](): AsyncIterator<Item> {
            return this.iterator();
        }
        /**
         * Splits the stream into two streams which can be
         * independently read from at different speeds.
         */
        tee(): [Stream<Item>, Stream<Item>] {
            const left: Promise<IteratorResult<Item>>[] = [];
            const right: Promise<IteratorResult<Item>>[] = [];
            const iterator = this.iterator();
            const teeIterator = (queue: Promise<IteratorResult<Item>>[]): AsyncIterator<Item> => {
                return {
                    next: () => {
                        if (queue.length === 0) {
                            const result = iterator.next();
                            left.push(result);
                            right.push(result);
                        }
                        return queue.shift()!;
                    },
                };
            };
            return [
                new Stream(() => teeIterator(left), this.controller, __classPrivateFieldGet(this, _Stream_client, "f")),
                new Stream(() => teeIterator(right), this.controller, __classPrivateFieldGet(this, _Stream_client, "f")),
            ];
        }
        /**
         * Converts this stream to a newline-separated ReadableStream of
         * JSON stringified values in the stream
         * which can be turned back into a Stream with `Stream.fromReadableStream()`.
         */
        toReadableStream(): GivenStream {
            const self = this;
            let iter: AsyncIterator<Item>;
            return makeReadableStream({
                async start() {
                    iter = /*$*/(/*$*/self/*$*/ as any)/*$*/[Symbol.asyncIterator]();
                },
                async pull(ctrl: any) {
                    try {
                        const { value, done } = await iter.next();
                        if (done)
                            return ctrl.close();
                        const bytes = encodeUTF8(JSON.stringify(value) + '\n');
                        ctrl.enqueue(bytes);
                    }
                    catch (err) {
                        ctrl.error(err);
                    }
                },
                async cancel() {
                    await iter.return?.();
                },
            });
        }
    }
    return Stream;
})();
export async function* _iterSSEMessages(response: Response, controller: AbortController): AsyncGenerator<ServerSentEvent, void, unknown> {
    if (!response.body) {
        controller.abort();
        if (typeof /*$*/(/*$*/globalThis/*$*/ as any)/*$*/.navigator !== 'undefined' &&
            /*$*/(/*$*/globalThis/*$*/ as any)/*$*/.navigator.product === 'ReactNative') {
            throw new AnthropicError(`The default react-native fetch implementation does not support streaming. Please use expo/fetch: https://docs.expo.dev/versions/latest/sdk/expo/#expofetch-api`);
        }
        throw new AnthropicError(`Attempted to iterate over a response with no body`);
    }
    const sseDecoder = new SSEDecoder();
    const lineDecoder = new LineDecoder();
    const iter = ReadableStreamToAsyncIterable<Bytes>(response.body);
    for await (const sseChunk of iterSSEChunks(iter)) {
        for (const line of lineDecoder.decode(sseChunk)) {
            const sse = sseDecoder.decode(line);
            if (sse)
                yield sse;
        }
    }
    for (const line of lineDecoder.flush()) {
        const sse = sseDecoder.decode(line);
        if (sse)
            yield sse;
    }
}
/**
 * Given an async iterable iterator, iterates over it and yields full
 * SSE chunks, i.e. yields when a double new-line is encountered.
 */
async function* iterSSEChunks(iterator: AsyncIterable<Bytes>): AsyncGenerator<Uint8Array> {
    let data = new Uint8Array();
    for await (const chunk of iterator) {
        if (chunk == null) {
            continue;
        }
        const binaryChunk: Uint8Array = chunk instanceof ArrayBuffer ? new Uint8Array(chunk)
            : typeof chunk === 'string' ? encodeUTF8(chunk)
                : chunk;
        let newData = new Uint8Array(data.length + binaryChunk.length);
        newData.set(data);
        newData.set(binaryChunk, data.length);
        data = newData;
        // Yield views, not copies, so a chunk holding many events is not re-copied
        // once per event. This relies on newData never being written again.
        let patternIndex: number;
        while ((patternIndex = findDoubleNewlineIndex(data)) !== -1) {
            yield data.subarray(0, patternIndex);
            data = data.subarray(patternIndex);
        }
    }
    if (data.length > 0) {
        yield data;
    }
}
class SSEDecoder { /*$*/declare event: string | null; declare data: string[]; declare chunks: string[];/*$*/
    constructor() {
        this.event = null;
        this.data = [];
        this.chunks = [];
    }
    decode(line: string): ServerSentEvent | null {
        if (line.endsWith('\r')) {
            line = line.substring(0, line.length - 1);
        }
        if (!line) {
            // empty line and we didn't previously encounter any messages
            if (!this.event && !this.data.length)
                return null;
            const sse: ServerSentEvent = {
                event: this.event,
                data: this.data.join('\n'),
                raw: this.chunks,
            };
            this.event = null;
            this.data = [];
            this.chunks = [];
            return sse;
        }
        this.chunks.push(line);
        if (line.startsWith(':')) {
            return null;
        }
        let [fieldname, _, value] = partition(line, ':');
        if (value.startsWith(' ')) {
            value = value.substring(1);
        }
        if (fieldname === 'event') {
            this.event = value;
        }
        else if (fieldname === 'data') {
            this.data.push(value);
        }
        return null;
    }
}
function partition(str: string, delimiter: string): [string, string, string] {
    const index = str.indexOf(delimiter);
    if (index !== -1) {
        return [str.substring(0, index), delimiter, str.substring(index + delimiter.length)];
    }
    return [str, '', ''];
}
//# sourceMappingURL=streaming.mjs.map

/*$*/export type ServerSentEvent = { event: string | null; data: string; raw: string[] };
type Bytes = string | ArrayBuffer | Uint8Array | null | undefined;
type Client = any;
type Logger = any;
type GivenStream = any;/*$*/