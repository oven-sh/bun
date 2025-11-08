/// buffer used to stream response to JS
scheduled_response_buffer: MutableString = undefined,

state: enum {
    created,
    enqueued,
    // information_headers,
    headers_received,
    receiving_body, // can be sent with the headers or separately
    // receiving_trailer_headers,
    failed,
    done,
} = .created,

const bun = @import("bun");
const MutableString = bun.MutableString;
