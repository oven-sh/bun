#!/usr/bin/env python3
# Scratch. The edits of the bun patches to lsquic_stream.c that are not taken from a patch file.
# usage: edit.py <step> <src lsquic_stream.c> <dst>
#   p1  frame-header-credit: signed count in stream_write_avail_with_frames, check in frame_hq_gen_read
#   p4  frame-header-credit-waits: the counters and their accessor (on top of p1)
import sys

step, src, dst = sys.argv[1:4]
s = open(src).read()


def rep(old, new, count=1):
    global s
    assert s.count(old) == count, (s.count(old), old[:80])
    s = s.replace(old, new)


if step == "p1":
    rep(
        """static size_t
stream_write_avail_with_frames (struct lsquic_stream *stream)
{
    uint64_t stream_avail, conn_avail;
    const struct stream_hq_frame *shf;
    size_t size;

    stream_avail = stream->max_send_off - stream->tosend_off
                                                - stream->sm_n_buffered;
    STAILQ_FOREACH(shf, &stream->sm_hq_frames, shf_next)
        if (!(shf->shf_flags & SHF_WRITTEN))
        {
            size = stream_hq_frame_size(shf);
            assert(size <= stream_avail);
            stream_avail -= size;
        }
""",
        """static size_t
stream_write_avail_with_frames (struct lsquic_stream *stream)
{
    /* bun: signed.  Upstream asserted that the stream's window has room for
     * the header of every frame that waits.  A header block can wait with less
     * than that, and without the assert the count wrapped to a huge value.
     * Now it goes below zero, and the stream is not writeable.
     */
    int64_t stream_avail;
    uint64_t conn_avail;
    const struct stream_hq_frame *shf;
    size_t size;

    stream_avail = (int64_t) (stream->max_send_off - stream->tosend_off
                                                - stream->sm_n_buffered);
    STAILQ_FOREACH(shf, &stream->sm_hq_frames, shf_next)
        if (!(shf->shf_flags & SHF_WRITTEN))
        {
            size = stream_hq_frame_size(shf);
            stream_avail -= (int64_t) size;
        }
""",
    )
    rep(
        """        if (conn_avail < stream_avail)
            stream_avail = conn_avail;
    }

    if (stream_avail >= 3 /* Smallest new frame */)
""",
        """        if ((int64_t) conn_avail < stream_avail)
            stream_avail = (int64_t) conn_avail;
    }

    if (stream_avail >= 3 /* Smallest new frame */)
""",
    )
    rep(
        """            LSQ_DEBUG("insert %zu-byte HQ frame of type 0x%X at payload "
""",
        """            /* bun: a frame whose bytes were never buffered (a header block that
             * waits for a packet or for credit) has taken no credit for its
             * header.  Without that credit, do not write the header: the
             * stream would pass the peer's MAX_DATA or MAX_STREAM_DATA.  The
             * stream stays on the write queue: send_headers_ietf() set
             * SMQF_WANT_WRITE for the block that waits.  incr_conn_cap()
             * charges the connection only for a stream that it limits.
             */
            if (!(shf->shf_flags & SHF_CC_PAID)
                    && (((stream->sm_bflags & SMBF_CONN_LIMITED)
                        && lsquic_conn_cap_avail(&stream->conn_pub->conn_cap)
                                                                < frame_sz)
                        || stream->max_send_off - stream->tosend_off
                                                                < frame_sz))
            {
                LSQ_DEBUG("no %s credit for %zu-byte HQ frame of type 0x%X at "
                    "payload offset %"PRIu64,
                    stream->max_send_off - stream->tosend_off < frame_sz
                        ? "stream" : "connection", frame_sz,
                    shf->shf_frame_type, stream->sm_payload);
                /* As above: a frame that was activated for this call */
                if (new)
                    stream_hq_frame_put(stream, shf);
                break;
            }
            LSQ_DEBUG("insert %zu-byte HQ frame of type 0x%X at payload "
""",
    )
elif step == "p4":
    rep(
        """static size_t
frame_hq_gen_read (void *ctx, void *begin_buf, size_t len, int *fin)
{
""",
        """/* bun: for tests.  How many times frame_hq_gen_read() stopped in front of a
 * frame header that had no connection credit ([0]) or no stream credit ([1]),
 * in all engines of the process.
 */
static unsigned long s_frame_header_waits[2];

unsigned long
lsquic_stream_frame_header_waits (int stream_credit);

unsigned long
lsquic_stream_frame_header_waits (int stream_credit)
{
    return __atomic_load_n(&s_frame_header_waits[!!stream_credit],
                                                        __ATOMIC_RELAXED);
}


static size_t
frame_hq_gen_read (void *ctx, void *begin_buf, size_t len, int *fin)
{
""",
    )
    rep(
        """                        ? "stream" : "connection", frame_sz,
                    shf->shf_frame_type, stream->sm_payload);
                /* As above: a frame that was activated for this call */
""",
        """                        ? "stream" : "connection", frame_sz,
                    shf->shf_frame_type, stream->sm_payload);
                __atomic_add_fetch(&s_frame_header_waits[
                    stream->max_send_off - stream->tosend_off < frame_sz],
                    1, __ATOMIC_RELAXED);
                /* As above: a frame that was activated for this call */
""",
    )
else:
    sys.exit("unknown step " + step)
open(dst, "w").write(s)
