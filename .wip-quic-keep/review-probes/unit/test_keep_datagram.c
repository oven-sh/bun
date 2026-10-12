/* Scratch probe (NOT part of the repo): candidate unit cases for
 * patches/lsquic/keep-unsent-datagram.patch, written against the harness of
 * vendor/lsquic/tests/test_send_ctl_accounting.c (same includes, same
 * init_test with a bare enpub).  Each case runs in its own process:
 *      ./test_keep_datagram <case> [bare]
 * "bare" leaves the fake connection as the upstream harness has it (not
 * LSCONN_TICKABLE), so lsquic_engine_add_conn_to_attq() runs on the bare
 * struct lsquic_engine_public.
 */
#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/queue.h>

#include "lsquic.h"
#include "lsquic_int_types.h"
#include "lsquic_types.h"
#include "lsquic_packet_common.h"
#include "lsquic_alarmset.h"
#include "lsquic_conn_flow.h"
#include "lsquic_rtt.h"
#include "lsquic_sfcw.h"
#include "lsquic_varint.h"
#include "lsquic_hq.h"
#include "lsquic_hash.h"
#include "lsquic_stream.h"
#include "lsquic_mm.h"
#include "lsquic_conn_public.h"
#include "lsquic_parse.h"
#include "lsquic_conn.h"
#include "lsquic_engine_public.h"
#include "lsquic_cong_ctl.h"
#include "lsquic_cubic.h"
#include "lsquic_pacer.h"
#include "lsquic_senhist.h"
#include "lsquic_bw_sampler.h"
#include "lsquic_minmax.h"
#include "lsquic_bbr.h"
#include "lsquic_adaptive_cc.h"
#include "lsquic_send_ctl.h"
#include "lsquic_ver_neg.h"
#include "lsquic_packet_out.h"
#include "lsquic_malo.h"
#include "lsquic_enc_sess.h"
#include "lsquic_util.h"


struct accounting_test
{
    struct lsquic_conn           lconn;
    struct lsquic_engine_public  enpub;
    struct lsquic_conn_public    conn_pub;
    struct lsquic_send_ctl       send_ctl;
    struct lsquic_alarmset       alset;
    struct ver_neg               ver_neg;
    struct network_path          path;
};

static int g_bare;          /* 1: keep the harness exactly as upstream has it */
static int g_block_cwnd;    /* 1: lsquic_send_ctl_can_send() says no */

/* Same override technique as tests/test_stream.c:126 (LSQUIC_TEST_WEAK). */
int
lsquic_send_ctl_can_send (struct lsquic_send_ctl *ctl)
{
    return !g_block_cwnd && ctl->sc_can_send(ctl);
}

#if STUB_ATTQ
#include "lsquic_attq.h"
static unsigned g_attq_calls;
static lsquic_time_t g_attq_time;
static unsigned g_attq_why;

void
lsquic_engine_add_conn_to_attq (struct lsquic_engine_public *enpub,
                    lsquic_conn_t *conn, lsquic_time_t tick_time, unsigned why)
{
    ++g_attq_calls;
    g_attq_time = tick_time;
    g_attq_why = why;
}
#endif

static unsigned g_n_status;
static uint64_t g_status_id[8];
static int      g_status[8];

static void
on_datagram_status (lsquic_conn_t *c, uint64_t id, int status)
{
    assert(g_n_status < 8);
    g_status_id[g_n_status] = id;
    g_status[g_n_status++] = status;
}

static struct lsquic_stream_if g_stream_if;
static struct conn_iface g_conn_if;
#if LSQUIC_CONN_STATS
static struct conn_stats g_conn_stats;
#endif


static void
init_test (struct accounting_test *t)
{
    unsigned i;

    memset(t, 0, sizeof(*t));
    LSCONN_INITIALIZE(&t->lconn);
    t->lconn.cn_flags |= LSCONN_IETF|LSCONN_HANDSHAKE_DONE;
    t->lconn.cn_version = LSQVER_I001;
    t->lconn.cn_pf = select_pf_by_ver(LSQVER_I001);
    t->lconn.cn_esf_c = &lsquic_enc_session_common_ietf_v1;
    /* Additions to the upstream init_test: */
    g_stream_if.on_datagram_status = on_datagram_status;
    t->enpub.enp_stream_if = &g_stream_if;  /* send_ctl_report_datagrams reads it */
    t->lconn.cn_if = &g_conn_if;            /* retx_alarm_rings reads ci_retx_timeout */
    if (!g_bare)
        t->lconn.cn_flags |= LSCONN_TICKABLE;   /* add_conn_to_attq returns early */

    lsquic_engine_init_settings(&t->enpub.enp_settings, 0);
    t->enpub.enp_settings.es_cc_algo = 1;  /* Cubic */
    lsquic_mm_init(&t->enpub.enp_mm);
    lsquic_alarmset_init(&t->alset, 0);

    TAILQ_INIT(&t->conn_pub.sending_streams);
    TAILQ_INIT(&t->conn_pub.read_streams);
    TAILQ_INIT(&t->conn_pub.write_streams);
    TAILQ_INIT(&t->conn_pub.service_streams);
    t->path.np_pack_size = 1370;
    t->path.np_path_id = 0;
    t->path.np_dcid.len = 8;
    for (i = 0; i < 8; ++i)
        t->path.np_dcid.idbuf[i] = (unsigned char) (0xA0 + i);
    t->conn_pub.mm = &t->enpub.enp_mm;
    t->conn_pub.lconn = &t->lconn;
    t->conn_pub.enpub = &t->enpub;
    t->conn_pub.send_ctl = &t->send_ctl;
    t->conn_pub.path = &t->path;
#if LSQUIC_CONN_STATS
    t->conn_pub.conn_stats = &g_conn_stats;     /* loss path counts into it */
#endif
    t->conn_pub.packet_out_malo =
                        lsquic_malo_create(sizeof(struct lsquic_packet_out));
    assert(t->conn_pub.packet_out_malo);

    lsquic_send_ctl_init(&t->send_ctl, &t->alset, &t->enpub, &t->ver_neg,
                                                &t->conn_pub, SC_IETF);
    /* lsquic_send_ctl_do_sanity_check() after every queue operation: */
    t->send_ctl.sc_flags |= SC_SANITY_CHECK;
}


static void
cleanup_test (struct accounting_test *t)
{
    lsquic_send_ctl_cleanup(&t->send_ctl);
    lsquic_malo_destroy(t->conn_pub.packet_out_malo);
    lsquic_mm_cleanup(&t->enpub.enp_mm);
}


static void
assert_scheduled_accounting (const struct accounting_test *t)
{
    const struct lsquic_packet_out *packet_out;
    unsigned count, bytes;

    count = 0;
    bytes = 0;
    TAILQ_FOREACH(packet_out, &t->send_ctl.sc_scheduled_packets, po_next)
    {
        assert(packet_out->po_flags & PO_SCHED);
        bytes += packet_out->po_acct_sz;
        ++count;
    }
    assert(count == t->send_ctl.sc_n_scheduled);
    assert(bytes == t->send_ctl.sc_bytes_scheduled);
}


static struct lsquic_packet_out *
new_packet (struct accounting_test *t)
{
    struct lsquic_packet_out *packet_out;

    packet_out = lsquic_send_ctl_new_packet_out(&t->send_ctl, 0, PNS_APP,
                                                                    &t->path);
    assert(packet_out);
    return packet_out;
}


/* What write_datagram() / generate_ack_frame() do to a packet, by hand. */
static void
add_frame (struct accounting_test *t, struct lsquic_packet_out *packet_out,
        enum quic_frame_type type, unsigned char fill, unsigned short len,
        uintptr_t data)
{
    int s;

    memset(packet_out->po_data + packet_out->po_data_sz, fill, len);
    s = lsquic_packet_out_add_frame(packet_out, &t->enpub.enp_mm, data, type,
                                                packet_out->po_data_sz, len);
    assert(0 == s);
    packet_out->po_data_sz += len;
    packet_out->po_frame_types |= 1 << type;
    if (BQUIC_FRAME_REGEN_MASK & (1 << type))
        packet_out->po_regen_sz += len;
}


/* The frame records that are still taken, in order. */
static unsigned
live_frecs (struct lsquic_packet_out *packet_out, struct frame_rec out[8])
{
    struct packet_out_frec_iter pofi;
    struct frame_rec *frec;
    unsigned n;

    n = 0;
    for (frec = lsquic_pofi_first(&pofi, packet_out); frec;
                                            frec = lsquic_pofi_next(&pofi))
    {
        assert(n < 8);
        out[n++] = *frec;
    }
    return n;
}


static void
assert_bytes (const struct lsquic_packet_out *packet_out, unsigned off,
                                        unsigned char fill, unsigned len)
{
    unsigned i;
    for (i = 0; i < len; ++i)
        assert(packet_out->po_data[off + i] == fill);
}


static void
send_packet (struct accounting_test *t, struct lsquic_packet_out *packet_out,
                                                        lsquic_time_t when)
{
    assert(0 == (packet_out->po_flags & PO_SCHED));
    packet_out->po_sent = when;
    assert(0 == lsquic_send_ctl_sent_packet(&t->send_ctl, packet_out));
}


/* A retransmittable packet is sent and then declared lost. */
static struct lsquic_packet_out *
lose_one_retx_packet (struct accounting_test *t)
{
    struct lsquic_packet_out *packet_out, *sent;

    packet_out = new_packet(t);
    add_frame(t, packet_out, QUIC_FRAME_MAX_DATA, 0x10, 3, 0);
    lsquic_send_ctl_scheduled_one(&t->send_ctl, packet_out);
    sent = lsquic_send_ctl_next_packet_to_send(&t->send_ctl, NULL);
    assert(sent == packet_out);
    send_packet(t, sent, 1000);
    assert(lsquic_alarmset_is_set(&t->alset, AL_RETX_APP));
    lsquic_send_ctl_expire_all(&t->send_ctl);
    assert(!lsquic_alarmset_is_set(&t->alset, AL_RETX_APP));
    assert(TAILQ_FIRST(&t->send_ctl.sc_lost_packets) == packet_out);
    return packet_out;
}


/* ---- PO_REPACKNO branch of lsquic_send_ctl_next_packet_to_send() ---- */

static void
test_repackno_datagram_only (void)
{
    struct accounting_test t;
    struct lsquic_packet_out *packet_out, *next;
    struct frame_rec frecs[8];
    unsigned acct_before;
    lsquic_packno_t oldno;

    init_test(&t);
    packet_out = new_packet(&t);
    add_frame(&t, packet_out, QUIC_FRAME_DATAGRAM, 0xD1, 5, 7);
    packet_out->po_flags |= PO_REPACKNO;
    lsquic_send_ctl_scheduled_one(&t.send_ctl, packet_out);
    acct_before = packet_out->po_acct_sz;
    oldno = packet_out->po_packno;

    assert(lsquic_send_ctl_next_packet_to_send_predict(&t.send_ctl));
    next = lsquic_send_ctl_next_packet_to_send(&t.send_ctl, NULL);
    assert(next == packet_out);     /* not dropped */
    assert(0 == (next->po_flags & PO_REPACKNO));
    assert(next->po_packno == oldno + 1);
    assert(next->po_frame_types == QUIC_FTBIT_DATAGRAM);
    assert(5 == next->po_data_sz && 5 == next->po_regen_sz);
    assert(next->po_acct_sz == acct_before);
    assert(0 == t.send_ctl.sc_bytes_scheduled);
    assert(1 == live_frecs(next, frecs));
    assert(QUIC_FRAME_DATAGRAM == frecs[0].fe_frame_type
        && 0 == frecs[0].fe_off && 5 == frecs[0].fe_len && 7 == frecs[0].fe_u.data);
    assert_bytes(next, 0, 0xD1, 5);
    assert(0 == g_n_status);

    lsquic_packet_out_destroy(next, &t.enpub, NULL);
    cleanup_test(&t);
}


static void
test_repackno_ack_datagram (int datagram_first)
{
    struct accounting_test t;
    struct lsquic_packet_out *packet_out, *next;
    struct frame_rec frecs[8];
    unsigned acct_before;

    init_test(&t);
    packet_out = new_packet(&t);
    if (datagram_first)
    {
        add_frame(&t, packet_out, QUIC_FRAME_DATAGRAM, 0xD1, 5, 7);
        add_frame(&t, packet_out, QUIC_FRAME_ACK, 0x02, 2, 0);
    }
    else
    {
        add_frame(&t, packet_out, QUIC_FRAME_ACK, 0x02, 2, 0);
        add_frame(&t, packet_out, QUIC_FRAME_DATAGRAM, 0xD1, 5, 7);
    }
    assert(7 == packet_out->po_data_sz && 7 == packet_out->po_regen_sz);
    packet_out->po_flags |= PO_REPACKNO;
    lsquic_send_ctl_scheduled_one(&t.send_ctl, packet_out);
    acct_before = packet_out->po_acct_sz;
    assert_scheduled_accounting(&t);

    next = lsquic_send_ctl_next_packet_to_send(&t.send_ctl, NULL);
    assert(next == packet_out);
    assert(next->po_frame_types == QUIC_FTBIT_DATAGRAM);    /* stale ACK cut */
    assert(5 == next->po_data_sz);
    assert(5 == next->po_regen_sz);
    assert(next->po_acct_sz == acct_before - 2);
    assert(0 == t.send_ctl.sc_bytes_scheduled);
    assert(1 == live_frecs(next, frecs));
    assert(QUIC_FRAME_DATAGRAM == frecs[0].fe_frame_type
        && 0 == frecs[0].fe_off && 5 == frecs[0].fe_len && 7 == frecs[0].fe_u.data);
    assert_bytes(next, 0, 0xD1, 5);

    lsquic_packet_out_destroy(next, &t.enpub, NULL);
    cleanup_test(&t);
}


/* ACK + a retransmittable frame + DATAGRAM: the shape of the JS test "keeps
 * a datagram in a packet that gets a new number before the send".
 */
static void
test_repackno_ack_retx_datagram (void)
{
    struct accounting_test t;
    struct lsquic_packet_out *packet_out, *next;
    struct frame_rec frecs[8];
    unsigned acct_before;

    init_test(&t);
    packet_out = new_packet(&t);
    add_frame(&t, packet_out, QUIC_FRAME_ACK, 0x02, 2, 0);
    add_frame(&t, packet_out, QUIC_FRAME_MAX_DATA, 0x10, 3, 0);
    add_frame(&t, packet_out, QUIC_FRAME_DATAGRAM, 0xD1, 5, 7);
    packet_out->po_flags |= PO_REPACKNO;
    lsquic_send_ctl_scheduled_one(&t.send_ctl, packet_out);
    acct_before = packet_out->po_acct_sz;

    next = lsquic_send_ctl_next_packet_to_send(&t.send_ctl, NULL);
    assert(next == packet_out);
    assert(next->po_frame_types == (QUIC_FTBIT_MAX_DATA|QUIC_FTBIT_DATAGRAM));
    assert(8 == next->po_data_sz);
    assert(5 == next->po_regen_sz);
    assert(next->po_acct_sz == acct_before - 2);
    assert(0 == t.send_ctl.sc_bytes_scheduled);
    assert(2 == live_frecs(next, frecs));
    assert(QUIC_FRAME_MAX_DATA == frecs[0].fe_frame_type
        && 0 == frecs[0].fe_off && 3 == frecs[0].fe_len);
    assert(QUIC_FRAME_DATAGRAM == frecs[1].fe_frame_type
        && 3 == frecs[1].fe_off && 5 == frecs[1].fe_len && 7 == frecs[1].fe_u.data);
    assert_bytes(next, 0, 0x10, 3);
    assert_bytes(next, 3, 0xD1, 5);

    lsquic_packet_out_destroy(next, &t.enpub, NULL);
    cleanup_test(&t);
}


/* STREAM + DATAGRAM with a real stream frame record, with and without an ACK. */
static void
test_repackno_stream_datagram (int with_ack)
{
    struct accounting_test t;
    struct lsquic_packet_out *packet_out, *next;
    struct frame_rec frecs[8];
    struct lsquic_stream stream;
    unsigned acct_before, ack;
    int s;

    init_test(&t);
    memset(&stream, 0, sizeof(stream));
    packet_out = new_packet(&t);
    ack = with_ack ? 2 : 0;
    if (with_ack)
        add_frame(&t, packet_out, QUIC_FRAME_ACK, 0x02, 2, 0);
    memset(packet_out->po_data + packet_out->po_data_sz, 0x08, 9);
    s = lsquic_packet_out_add_stream(packet_out, &t.enpub.enp_mm, &stream,
                            QUIC_FRAME_STREAM, packet_out->po_data_sz, 9);
    assert(0 == s);
    packet_out->po_data_sz += 9;
    packet_out->po_frame_types |= QUIC_FTBIT_STREAM;
    add_frame(&t, packet_out, QUIC_FRAME_DATAGRAM, 0xD1, 5, 7);
    packet_out->po_flags |= PO_REPACKNO;
    lsquic_send_ctl_scheduled_one(&t.send_ctl, packet_out);
    acct_before = packet_out->po_acct_sz;

    next = lsquic_send_ctl_next_packet_to_send(&t.send_ctl, NULL);
    assert(next == packet_out);
    assert(next->po_frame_types == (QUIC_FTBIT_STREAM|QUIC_FTBIT_DATAGRAM));
    assert(14 == next->po_data_sz);
    assert(5 == next->po_regen_sz);
    assert(next->po_acct_sz == acct_before - ack);
    assert(0 == t.send_ctl.sc_bytes_scheduled);
    assert(2 == live_frecs(next, frecs));
    assert(QUIC_FRAME_STREAM == frecs[0].fe_frame_type && &stream == frecs[0].fe_stream
        && 0 == frecs[0].fe_off && 9 == frecs[0].fe_len);
    assert(QUIC_FRAME_DATAGRAM == frecs[1].fe_frame_type
        && 9 == frecs[1].fe_off && 5 == frecs[1].fe_len && 7 == frecs[1].fe_u.data);
    assert_bytes(next, 0, 0x08, 9);
    assert_bytes(next, 9, 0xD1, 5);

    lsquic_packet_out_destroy(next, &t.enpub, NULL);
    cleanup_test(&t);
}


/* Two DATAGRAM frames around an ACK: both offsets move, both ids stay. */
static void
test_repackno_datagram_ack_datagram (void)
{
    struct accounting_test t;
    struct lsquic_packet_out *packet_out, *next;
    struct frame_rec frecs[8];
    unsigned acct_before;

    init_test(&t);
    packet_out = new_packet(&t);
    add_frame(&t, packet_out, QUIC_FRAME_DATAGRAM, 0xD1, 4, 1);
    add_frame(&t, packet_out, QUIC_FRAME_ACK, 0x02, 2, 0);
    add_frame(&t, packet_out, QUIC_FRAME_DATAGRAM, 0xD2, 6, 2);
    packet_out->po_flags |= PO_REPACKNO;
    lsquic_send_ctl_scheduled_one(&t.send_ctl, packet_out);
    acct_before = packet_out->po_acct_sz;

    next = lsquic_send_ctl_next_packet_to_send(&t.send_ctl, NULL);
    assert(next == packet_out);
    assert(next->po_frame_types == QUIC_FTBIT_DATAGRAM);
    assert(10 == next->po_data_sz && 10 == next->po_regen_sz);
    assert(next->po_acct_sz == acct_before - 2);
    assert(0 == t.send_ctl.sc_bytes_scheduled);
    assert(2 == live_frecs(next, frecs));
    assert(0 == frecs[0].fe_off && 4 == frecs[0].fe_len && 1 == frecs[0].fe_u.data);
    assert(4 == frecs[1].fe_off && 6 == frecs[1].fe_len && 2 == frecs[1].fe_u.data);
    assert_bytes(next, 0, 0xD1, 4);
    assert_bytes(next, 4, 0xD2, 6);

    lsquic_packet_out_destroy(next, &t.enpub, NULL);
    cleanup_test(&t);
}


/* The refused-send path end to end: an ACK + DATAGRAM packet leaves the
 * scheduled queue, the socket refuses it (ci_packet_not_sent ->
 * lsquic_send_ctl_delayed_one), the squeeze of the next tick keeps it, the
 * tick resets the numbers before it writes a fresh ACK, and the packet goes
 * out again with the stale ACK cut and the DATAGRAM frame in place.
 */
static void
test_refused_send_ack_datagram (void)
{
    struct accounting_test t;
    struct lsquic_packet_out *packet_out, *next;
    struct frame_rec frecs[8];
    lsquic_packno_t first_no;

    init_test(&t);
    packet_out = new_packet(&t);
    add_frame(&t, packet_out, QUIC_FRAME_ACK, 0x02, 2, 0);
    add_frame(&t, packet_out, QUIC_FRAME_DATAGRAM, 0xD1, 5, 7);
    lsquic_send_ctl_scheduled_one(&t.send_ctl, packet_out);
    first_no = packet_out->po_packno;

    next = lsquic_send_ctl_next_packet_to_send(&t.send_ctl, NULL);
    assert(next == packet_out);
    lsquic_send_ctl_delayed_one(&t.send_ctl, next);          /* refused */
    assert(1 == t.send_ctl.sc_n_scheduled);
    assert_scheduled_accounting(&t);

    assert(1 == lsquic_send_ctl_squeeze_sched(&t.send_ctl)); /* kept */
    assert(TAILQ_FIRST(&t.send_ctl.sc_scheduled_packets) == packet_out);
    lsquic_send_ctl_reset_packnos(&t.send_ctl);              /* tick, before a new ACK */

    next = lsquic_send_ctl_next_packet_to_send(&t.send_ctl, NULL);
    assert(next == packet_out);
    assert(next->po_packno == first_no);    /* nothing was sent: no gap */
    assert(next->po_frame_types == QUIC_FTBIT_DATAGRAM);
    assert(5 == next->po_data_sz && 5 == next->po_regen_sz);
    assert(0 == t.send_ctl.sc_bytes_scheduled);
    assert(1 == live_frecs(next, frecs));
    assert(0 == frecs[0].fe_off && 5 == frecs[0].fe_len && 7 == frecs[0].fe_u.data);
    assert_bytes(next, 0, 0xD1, 5);
    assert(0 == g_n_status);

    lsquic_packet_out_destroy(next, &t.enpub, NULL);
    cleanup_test(&t);
}


/* ---- lsquic_send_ctl_squeeze_sched() ---- */

static void
test_squeeze_keeps_datagram_only (void)
{
    struct accounting_test t;
    struct lsquic_packet_out *dg, *ack;

    init_test(&t);
    dg = new_packet(&t);
    add_frame(&t, dg, QUIC_FRAME_DATAGRAM, 0xD1, 5, 7);
    lsquic_send_ctl_scheduled_one(&t.send_ctl, dg);
    ack = new_packet(&t);
    add_frame(&t, ack, QUIC_FRAME_ACK, 0x02, 2, 0);
    lsquic_send_ctl_scheduled_one(&t.send_ctl, ack);

    assert(1 == lsquic_send_ctl_squeeze_sched(&t.send_ctl));   /* ACK-only goes */
    assert(1 == t.send_ctl.sc_n_scheduled);
    assert(TAILQ_FIRST(&t.send_ctl.sc_scheduled_packets) == dg);
    assert(dg->po_flags & PO_REPACKNO);     /* a packet was dropped */
    assert(dg->po_frame_types == QUIC_FTBIT_DATAGRAM && 5 == dg->po_data_sz);
    assert_scheduled_accounting(&t);
    assert(!lsquic_alarmset_is_set(&t.alset, AL_RETX_APP));   /* no lost packets */
    assert(0 == g_n_status);

    cleanup_test(&t);
}


/* Liveness rule 1: lost packets go in front of a kept DATAGRAM packet. */
static void
test_squeeze_reschedules_lost_in_front (void)
{
    struct accounting_test t;
    struct lsquic_packet_out *lost, *dg, *a, *b;

    init_test(&t);
    lost = lose_one_retx_packet(&t);
    dg = new_packet(&t);
    add_frame(&t, dg, QUIC_FRAME_DATAGRAM, 0xD1, 5, 7);
    lsquic_send_ctl_scheduled_one(&t.send_ctl, dg);

    assert(1 == lsquic_send_ctl_squeeze_sched(&t.send_ctl));
    assert(TAILQ_EMPTY(&t.send_ctl.sc_lost_packets));
    assert(2 == t.send_ctl.sc_n_scheduled);
    assert(TAILQ_FIRST(&t.send_ctl.sc_scheduled_packets) == lost);
    assert(TAILQ_NEXT(lost, po_next) == dg);
    assert((lost->po_flags & PO_REPACKNO) && (dg->po_flags & PO_REPACKNO));
    assert_scheduled_accounting(&t);
    assert(!lsquic_alarmset_is_set(&t.alset, AL_RETX_APP));

    /* Both leave, in that order, with rising numbers and no gap. */
    a = lsquic_send_ctl_next_packet_to_send(&t.send_ctl, NULL);
    assert(a == lost);
    assert(a->po_packno == lsquic_senhist_largest(&t.send_ctl.sc_senhist) + 1);
    send_packet(&t, a, 2000);
    assert(lsquic_alarmset_is_set(&t.alset, AL_RETX_APP));
    b = lsquic_send_ctl_next_packet_to_send(&t.send_ctl, NULL);
    assert(b == dg);
    assert(b->po_packno == a->po_packno + 1);
    assert(b->po_frame_types == QUIC_FTBIT_DATAGRAM && 5 == b->po_data_sz);
    send_packet(&t, b, 2001);
    assert(0 == t.send_ctl.sc_n_scheduled && 0 == t.send_ctl.sc_bytes_scheduled);
    assert(0 == g_n_status);

    cleanup_test(&t);
}


/* Alarm call 2 of 3: a delayed retransmittable packet is scheduled behind
 * the DATAGRAM packet, so the lost packets are not rescheduled and the
 * alarm is made sure of instead (the arm the design plan did not have).
 */
static void
test_squeeze_sched_retx_sets_alarm (void)
{
    struct accounting_test t;
    struct lsquic_packet_out *lost, *dg, *retx;

    init_test(&t);
    lost = lose_one_retx_packet(&t);
    dg = new_packet(&t);
    add_frame(&t, dg, QUIC_FRAME_DATAGRAM, 0xD1, 5, 7);
    lsquic_send_ctl_scheduled_one(&t.send_ctl, dg);
    retx = new_packet(&t);
    add_frame(&t, retx, QUIC_FRAME_MAX_DATA, 0x10, 3, 0);
    lsquic_send_ctl_scheduled_one(&t.send_ctl, retx);

    assert(1 == lsquic_send_ctl_squeeze_sched(&t.send_ctl));
    assert(2 == t.send_ctl.sc_n_scheduled);
    assert(TAILQ_FIRST(&t.send_ctl.sc_scheduled_packets) == dg);
    assert(TAILQ_FIRST(&t.send_ctl.sc_lost_packets) == lost);   /* still lost */
    assert(lsquic_alarmset_is_set(&t.alset, AL_RETX_APP));
    assert_scheduled_accounting(&t);

    cleanup_test(&t);
}


/* Alarm call 3 of 3: no lost packet can be rescheduled (cwnd). */
static void
test_squeeze_no_resched_sets_alarm (void)
{
    struct accounting_test t;
    struct lsquic_packet_out *lost, *dg;

    init_test(&t);
    lost = lose_one_retx_packet(&t);
    dg = new_packet(&t);
    add_frame(&t, dg, QUIC_FRAME_DATAGRAM, 0xD1, 5, 7);
    lsquic_send_ctl_scheduled_one(&t.send_ctl, dg);

    g_block_cwnd = 1;
    assert(1 == lsquic_send_ctl_squeeze_sched(&t.send_ctl));
    g_block_cwnd = 0;
    assert(1 == t.send_ctl.sc_n_scheduled);
    assert(TAILQ_FIRST(&t.send_ctl.sc_scheduled_packets) == dg);
    assert(TAILQ_FIRST(&t.send_ctl.sc_lost_packets) == lost);
    assert(lsquic_alarmset_is_set(&t.alset, AL_RETX_APP));

    cleanup_test(&t);
}


/* Alarm call 1 of 3 (liveness rule 2): a DATAGRAM packet waits behind
 * sc_next_limit == 0 after an RTO and nothing retransmittable is in flight.
 * The alarm is set, it rings as an RTO, and the packet leaves.
 */
static void
test_gate_sets_alarm_and_datagram_leaves (void)
{
    struct accounting_test t;
    struct lsquic_packet_out *dg, *next;
    lsquic_time_t expiry;

    init_test(&t);
    dg = new_packet(&t);
    add_frame(&t, dg, QUIC_FRAME_DATAGRAM, 0xD1, 5, 7);
    lsquic_send_ctl_scheduled_one(&t.send_ctl, dg);

    /* The state after an RTO whose two packets were used up: */
    t.send_ctl.sc_n_tlp = 2;
    t.send_ctl.sc_n_consec_rtos = 1;
    t.send_ctl.sc_next_limit = 0;
    assert(!lsquic_alarmset_is_set(&t.alset, AL_RETX_APP));
    assert(0 == lsquic_send_ctl_next_packet_to_send_predict(&t.send_ctl));

    next = lsquic_send_ctl_next_packet_to_send(&t.send_ctl, NULL);
    assert(NULL == next);
    assert(1 == t.send_ctl.sc_n_scheduled);
    assert(lsquic_alarmset_is_set(&t.alset, AL_RETX_APP));
    expiry = t.alset.as_expiry[AL_RETX_APP];
    assert(expiry > lsquic_time_now());
#if STUB_ATTQ
    assert(1 == g_attq_calls);
    assert(g_attq_time == expiry);
    assert(g_attq_why == N_AEWS + AL_RETX_APP);
#endif

    /* A second call does not move the alarm. */
    next = lsquic_send_ctl_next_packet_to_send(&t.send_ctl, NULL);
    assert(NULL == next);
    assert(expiry == t.alset.as_expiry[AL_RETX_APP]);

    {
        uint64_t cwnd_before = t.send_ctl.sc_ci->cci_get_cwnd(t.send_ctl.sc_cong_ctl);
        lsquic_alarmset_ring_expired(&t.alset, expiry + 1);
        fprintf(stderr, "patch-armed RETX alarm rang: cwnd %llu -> %llu, consec_rtos 1 -> %u, "
            "next_limit 0 -> %u, n_in_flight_all %u, alarm set again: %u\n",
            (unsigned long long) cwnd_before,
            (unsigned long long) t.send_ctl.sc_ci->cci_get_cwnd(t.send_ctl.sc_cong_ctl),
            t.send_ctl.sc_n_consec_rtos, t.send_ctl.sc_next_limit,
            t.send_ctl.sc_n_in_flight_all,
            !!lsquic_alarmset_is_set(&t.alset, AL_RETX_APP));
    }
    assert(2 == t.send_ctl.sc_n_consec_rtos);
    assert(2 == t.send_ctl.sc_next_limit);
    next = lsquic_send_ctl_next_packet_to_send(&t.send_ctl, NULL);
    assert(next == dg);
    assert(1 == t.send_ctl.sc_next_limit);
    assert(next->po_frame_types == QUIC_FTBIT_DATAGRAM && 5 == next->po_data_sz);
    assert(0 == g_n_status);

    lsquic_packet_out_destroy(next, &t.enpub, NULL);
    cleanup_test(&t);
}


static const struct { const char *name; void (*run)(void); int arg; } cases[] = {
    { "repackno_datagram_only",          test_repackno_datagram_only, },
    { "repackno_ack_datagram",           (void (*)(void)) test_repackno_ack_datagram, 0, },
    { "repackno_datagram_ack",           (void (*)(void)) test_repackno_ack_datagram, 1, },
    { "repackno_ack_retx_datagram",      test_repackno_ack_retx_datagram, },
    { "repackno_stream_datagram",        (void (*)(void)) test_repackno_stream_datagram, 0, },
    { "repackno_ack_stream_datagram",    (void (*)(void)) test_repackno_stream_datagram, 1, },
    { "repackno_datagram_ack_datagram",  test_repackno_datagram_ack_datagram, },
    { "refused_send_ack_datagram",       test_refused_send_ack_datagram, },
    { "squeeze_keeps_datagram_only",     test_squeeze_keeps_datagram_only, },
    { "squeeze_reschedules_lost_in_front", test_squeeze_reschedules_lost_in_front, },
    { "squeeze_sched_retx_sets_alarm",   test_squeeze_sched_retx_sets_alarm, },
    { "squeeze_no_resched_sets_alarm",   test_squeeze_no_resched_sets_alarm, },
    { "gate_sets_alarm_and_datagram_leaves", test_gate_sets_alarm_and_datagram_leaves, },
};


int
main (int argc, char **argv)
{
    unsigned i;

    if (argc < 2)
    {
        for (i = 0; i < sizeof(cases) / sizeof(cases[0]); ++i)
            puts(cases[i].name);
        return 0;
    }
    g_bare = argc > 2 && 0 == strcmp(argv[2], "bare");
    for (i = 0; i < sizeof(cases) / sizeof(cases[0]); ++i)
        if (0 == strcmp(argv[1], cases[i].name))
        {
            if (cases[i].run == (void (*)(void)) test_repackno_ack_datagram)
                test_repackno_ack_datagram(cases[i].arg);
            else if (cases[i].run == (void (*)(void)) test_repackno_stream_datagram)
                test_repackno_stream_datagram(cases[i].arg);
            else
                cases[i].run();
            return 0;
        }
    fprintf(stderr, "no such case: %s\n", argv[1]);
    return 2;
}
