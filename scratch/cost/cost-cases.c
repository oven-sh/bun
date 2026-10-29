/* ---- scratch: the workloads for the instruction count.  Each writes whole HTTP/3 messages through
 * lsquic_stream.c with large windows and packets at hand, so no credit check stops anything. ---- */

/* BUN_COST_KIND:
 *   response   a header block, a body of BUN_COST_BODY bytes, the end of the stream
 *   headers    a header block and the end of the stream
 *   interim    a 103, the final header block, a body, the end of the stream
 *   trailers   a header block, a body, trailers
 * BUN_COST_STREAMS: how many streams do that, one after the other.
 */
static void
cost_workload (void)
{
    struct test_objs tobjs;
    struct lsquic_stream *stream;
    struct lsxpack_header early = { XHDR(":status", "103") };
    struct lsxpack_header status = { XHDR(":status", "200") };
    struct lsxpack_header trailer = { XHDR("x-end", "1") };
    struct lsquic_http_headers early_headers = { 1, &early, };
    struct lsquic_http_headers headers = { 1, &status, };
    struct lsquic_http_headers trailers = { 1, &trailer, };
    const char *const kind = getenv("BUN_COST_KIND");
    const unsigned n_streams = (unsigned) atoi(getenv("BUN_COST_STREAMS"));
    const size_t body_sz = (size_t) atoi(getenv("BUN_COST_BODY"));
    unsigned char *const body = malloc(body_sz + 1);
    unsigned i;
    ssize_t nw;
    int s;

    memset(body, 'b', body_sz);
    init_test_ctl_settings(&g_ctl_settings);
    g_ctl_settings.tcs_schedule_stream_packets_immediately = 1;
    stream_ctor_flags |= SCF_IETF;
    init_test_objs(&tobjs, 0x40000000, 0x40000000, 1252);
    tobjs.ctor_flags |= SCF_HTTP|SCF_IETF;

    for (i = 0; i < n_streams; ++i)
    {
        stream = new_stream(&tobjs, 4 * i, 0x40000000);
        if (0 == strcmp(kind, "interim"))
        {
            s = lsquic_stream_send_headers(stream, &early_headers, 0);
            assert(0 == s);
        }
        s = lsquic_stream_send_headers(stream, &headers, 0);
        assert(0 == s);
        if (0 != strcmp(kind, "headers"))
        {
            nw = lsquic_stream_write(stream, body, body_sz);
            assert(nw >= 0 && (size_t) nw == body_sz);
        }
        if (0 == strcmp(kind, "trailers"))
        {
            s = lsquic_stream_send_headers(stream, &trailers, 1);
            assert(0 == s);
        }
        s = lsquic_stream_shutdown(stream, 1);
        assert(0 == s);
        lsquic_stream_dispatch_write_events(stream);
        assert(0 == stream->sm_n_buffered);
        assert(!stream->sm_header_block);
        lsquic_stream_destroy(stream);
    }

    deinit_test_objs(&tobjs);
    stream_ctor_flags &= ~SCF_IETF;
    free(body);
}
