HPACK, the header compression of HTTP/2 (RFC 7541). One [`Encoder`] and one [`Decoder`] per connection.

The two tables of a connection stay equal only if both sides see the same blocks in the same order. The types do not
enforce that. This is what a caller has to see to.

## Sending

- A header block goes to the peer whole, and blocks go out in the order they were encoded.
- A block of which even one field was encoded and that is not sent after all: [`Encoder::discard_block`], before a field of
  any other block is encoded. That includes a block that code called in between encodes. Or close the connection.
- [`Error::TooLarge`] wrote nothing for that field, but the fields before it are in `out` and in the table. Give the
  block up as above, or send the field with [`Encoder::encode_verbatim`].
- [`Encoder::set_max_capacity`] between blocks only. Inside one, the size update lands where the peer refuses it (§4.2).
- The table never takes more than 4,096 bytes, whatever the peer allows.
- Nothing is checked: not the case of a name, not the bytes of a value, not an empty name, which [`Decoder`] refuses.

## Receiving

- Every header block the peer sends is decoded, in the order it arrived, to its end: also one for a stream that is
  closed, refused or over a limit. It may add to the table.
- `block` is the whole block: the fragments of HEADERS or PUSH_PROMISE and of its CONTINUATION frames, without padding,
  priority and promised stream id. `*pos` is 0 at its first byte, which is how a size update is told to be in its place.
- An error ends the connection (RFC 9113 §4.3). The decoder is of no use after it.
- One field has at most 64 KiB. Neither the number of fields nor their sum has a limit here, and one byte of a block can
  stand for a field as large as the table, so the caller counts.
- A name is not empty. Nothing else is checked: upper case, control bytes, pseudo-header rules are the caller's.
- [`Decoder::set_max_capacity`] when the peer acknowledges the SETTINGS frame, not when it is sent. A larger size may
  come sooner: more room than the peer's encoder uses does no harm.
