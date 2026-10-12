source /tmp/_cgap/common.gdb
set $inject = 0
# Emulates one rule at the place where the fact is known: a packet with DATAGRAM frames and no retransmittable
# frame has just been SENT, no RETX_APP alarm is set, and lost or scheduled packets wait.
# AL_RETX_APP is alarm 3 (as_armed_set bit 0x8). QUIC_FTBIT_DATAGRAM is 0x4000000.
break lsquic_send_ctl.c:884 if (packet_out->po_frame_types & 0x4000000) && !(packet_out->po_frame_types & ctl->sc_retx_frames) && !(ctl->sc_alset->as_armed_set & 0x8) && (ctl->sc_lost_packets.tqh_first != 0 || ctl->sc_n_scheduled != 0)
commands
  silent
  set $inject = $inject + 1
  printf "@@INJECT sent DATAGRAM-only packet #%llu with no RETX alarm: lost_nonempty=%d n_sched=%u consec_rtos=%u -> ensure\n", (unsigned long long) packet_out->po_packno, ctl->sc_lost_packets.tqh_first != 0, ctl->sc_n_scheduled, ctl->sc_n_consec_rtos
  call send_ctl_ensure_retx_alarm(ctl, 2)
  continue
end
run
printf "@@SUMMARY injected=%d\n", $inject
