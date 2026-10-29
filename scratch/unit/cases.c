/* A 103 takes all of the connection's credit while no packet can be sent, so
 * the stream's own flush (maybe_flush_stream()) stays pending.  The final
 * headers wait.  When packets come back, the flush of the 103 must not write
 * the HEADERS frame header of the block that waits: the connection has no
 * credit for it.
 */
static void
test_waiting_headers_frame_respects_conn_cap (void)
{
    struct test_objs tobjs;
    struct lsquic_stream *stream;
    struct lsxpack_header early = { XHDR(":status", "103") };
    struct lsxpack_header final = { XHDR(":status", "200") };
    struct lsquic_http_headers early_headers = { 1, &early, };
    struct lsquic_http_headers final_headers = { 1, &final, };
    int s;

    init_test_ctl_settings(&g_ctl_settings);
    g_ctl_settings.tcs_schedule_stream_packets_immediately = 1;
    g_ctl_settings.tcs_can_send = 0;
    stream_ctor_flags |= SCF_IETF;
    /* 5 bytes: the HEADERS frame of the 103 */
    init_test_objs(&tobjs, 5, 0x1000, 1252);
    tobjs.ctor_flags |= SCF_HTTP|SCF_IETF;
    stream = new_stream(&tobjs, 0, 0x1000);

    s = lsquic_stream_send_headers(stream, &early_headers, 0);
    assert(0 == s);
    s = lsquic_stream_send_headers(stream, &final_headers, 0);
    assert(0 == s);
    assert(stream->sm_header_block);    /* The final block waits */

    g_ctl_settings.tcs_can_send = INT_MAX;
    lsquic_stream_dispatch_write_events(stream);
    assert(tobjs.conn_pub.conn_cap.cc_sent <= tobjs.conn_pub.conn_cap.cc_max);
    assert(stream->sm_header_block);    /* It still waits: no MAX_DATA came */

    tobjs.conn_pub.conn_cap.cc_max += 0x1000;   /* MAX_DATA */
    lsquic_stream_dispatch_write_events(stream);
    assert(!stream->sm_header_block);
    assert(tobjs.conn_pub.conn_cap.cc_sent <= tobjs.conn_pub.conn_cap.cc_max);

    lsquic_stream_destroy(stream);
    deinit_test_objs(&tobjs);
    stream_ctor_flags &= ~SCF_IETF;
}


/* The same for the stream's window: a 103 takes all of it, and the final
 * headers must wait for MAX_STREAM_DATA.
 */
static void
test_waiting_headers_frame_respects_stream_window (void)
{
    struct test_objs tobjs;
    struct lsquic_stream *stream;
    struct lsxpack_header early = { XHDR(":status", "103") };
    struct lsxpack_header final = { XHDR(":status", "200") };
    struct lsquic_http_headers early_headers = { 1, &early, };
    struct lsquic_http_headers final_headers = { 1, &final, };
    int s;

    init_test_ctl_settings(&g_ctl_settings);
    g_ctl_settings.tcs_schedule_stream_packets_immediately = 1;
    stream_ctor_flags |= SCF_IETF;
    init_test_objs(&tobjs, 0x1000, 0x1000, 1252);
    tobjs.ctor_flags |= SCF_HTTP|SCF_IETF;
    /* 5 bytes: the HEADERS frame of the 103 */
    stream = new_stream(&tobjs, 0, 5);

    s = lsquic_stream_send_headers(stream, &early_headers, 0);
    assert(0 == s);
    s = lsquic_stream_send_headers(stream, &final_headers, 0);
    assert(0 == s);
    /* The final block waits: the stream took no byte past its window */
    assert(stream->tosend_off + stream->sm_n_buffered <= stream->max_send_off);
    assert(stream->sm_header_block);
    lsquic_stream_dispatch_write_events(stream);
    assert(stream->tosend_off <= stream->max_send_off);
    assert(stream->sm_header_block);

    lsquic_stream_window_update(stream, 0x1000);    /* MAX_STREAM_DATA */
    lsquic_stream_dispatch_write_events(stream);
    assert(!stream->sm_header_block);
    assert(stream->tosend_off <= stream->max_send_off);

    lsquic_stream_destroy(stream);
    deinit_test_objs(&tobjs);
    stream_ctor_flags &= ~SCF_IETF;
}


/* The stream's window again, through the flush.  The 103 is in the stream's
 * buffer, because no packet can be sent, and it leaves 1 byte of the window.
 * The final headers wait.  When packets come back, the flush of the 103 must
 * not write the HEADERS frame header of the block that waits.
 */
static void
test_flush_respects_stream_window (void)
{
    struct test_objs tobjs;
    struct lsquic_stream *stream;
    struct lsxpack_header early = { XHDR(":status", "103") };
    struct lsxpack_header final = { XHDR(":status", "200") };
    struct lsquic_http_headers early_headers = { 1, &early, };
    struct lsquic_http_headers final_headers = { 1, &final, };
    int s;

    init_test_ctl_settings(&g_ctl_settings);
    g_ctl_settings.tcs_schedule_stream_packets_immediately = 1;
    g_ctl_settings.tcs_can_send = 0;
    stream_ctor_flags |= SCF_IETF;
    init_test_objs(&tobjs, 0x1000, 0x1000, 1252);
    tobjs.ctor_flags |= SCF_HTTP|SCF_IETF;
    /* 6 bytes: the HEADERS frame of the 103, and 1 byte */
    stream = new_stream(&tobjs, 0, 6);

    s = lsquic_stream_send_headers(stream, &early_headers, 0);
    assert(0 == s);
    s = lsquic_stream_send_headers(stream, &final_headers, 0);
    assert(0 == s);
    /* The final block waits: the stream took no byte past its window */
    assert(stream->tosend_off + stream->sm_n_buffered <= stream->max_send_off);
    assert(stream->sm_header_block);

    g_ctl_settings.tcs_can_send = INT_MAX;
    lsquic_stream_dispatch_write_events(stream);
    assert(stream->tosend_off <= stream->max_send_off);
    assert(stream->sm_header_block);    /* It still waits */

    lsquic_stream_window_update(stream, 0x1000);    /* MAX_STREAM_DATA */
    lsquic_stream_dispatch_write_events(stream);
    assert(!stream->sm_header_block);
    assert(stream->tosend_off <= stream->max_send_off);

    lsquic_stream_destroy(stream);
    deinit_test_objs(&tobjs);
    stream_ctor_flags &= ~SCF_IETF;
}


static void
stall_on_write (lsquic_stream_t *stream, lsquic_stream_ctx_t *ctx)
{
    lsquic_stream_wantwrite(stream, 0);
    lsquic_stream_flush(stream);
}


static lsquic_stream_ctx_t *
stall_on_new_stream (void *stream_if_ctx, lsquic_stream_t *stream)
{
    return NULL;
}


static const struct lsquic_stream_if stall_stream_if = {
    .on_new_stream = stall_on_new_stream,
    .on_close      = packetization_on_close,
    .on_write      = stall_on_write,
};


/* Scenario 1 of the comment above maybe_flush_stream(): two streams buffer a
 * header block each, and together the blocks use up the connection's credit.
 * Both streams want to write.  The implicit flush runs only for the stream
 * whose write used up the credit.  The other stream is not writeable, so it
 * gets no write event, and its block never leaves the buffer.
 */
static void
test_buffered_stream_is_flushed_when_conn_cap_is_used_up (void)
{
    struct test_objs tobjs;
    struct lsquic_stream *a, *b;
    struct lsxpack_header status = { XHDR(":status", "200") };
    struct lsquic_http_headers headers = { 1, &status, };
    unsigned i;
    int s;

    init_test_ctl_settings(&g_ctl_settings);
    g_ctl_settings.tcs_schedule_stream_packets_immediately = 1;
    stream_ctor_flags |= SCF_IETF;
    /* 10 bytes: the HEADERS frames of two `:status 200' blocks */
    init_test_objs(&tobjs, 10, 0x1000, 1252);
    tobjs.ctor_flags |= SCF_HTTP|SCF_IETF;
    tobjs.stream_if = &stall_stream_if;
    tobjs.stream_if_ctx = NULL;
    a = new_stream(&tobjs, 0, 0x1000);
    b = new_stream(&tobjs, 4, 0x1000);

    s = lsquic_stream_send_headers(a, &headers, 0);
    assert(0 == s);
    lsquic_stream_wantwrite(a, 1);
    assert(a->sm_n_buffered > 0);
    s = lsquic_stream_send_headers(b, &headers, 0);
    assert(0 == s);
    lsquic_stream_wantwrite(b, 1);
    assert(0 == lsquic_conn_cap_avail(&tobjs.conn_pub.conn_cap));

    for (i = 0; i < 3; ++i)
    {
        lsquic_stream_dispatch_write_events(a);
        lsquic_stream_dispatch_write_events(b);
    }
    /* The peer can send MAX_DATA only for bytes that it got */
    assert(0 == a->sm_n_buffered);
    assert(0 == b->sm_n_buffered);

    lsquic_stream_destroy(a);
    lsquic_stream_destroy(b);
    deinit_test_objs(&tobjs);
    stream_ctor_flags &= ~SCF_IETF;
}
