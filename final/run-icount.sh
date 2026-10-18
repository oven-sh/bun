#!/bin/bash
# Own-instruction counts of the functions on the request path, release builds of main and of the head.
cd /tmp/h2repro/icount
OUT=/tmp/h2repro/final/icount
mkdir -p $OUT
SYMS=(
"<bun_runtime::api::h2::connection::Connection>::receive::<bun_runtime::api::h2_frame_parser_body::H2FrameParser>"
"<bun_runtime::api::h2::connection::Connection>::finish_header_block::<bun_runtime::api::h2_frame_parser_body::H2FrameParser>"
"<bun_runtime::api::h2_frame_parser_body::H2FrameParser>::handle_received_stream_id"
"<bun_runtime::api::h2_frame_parser_body::Stream>::free_resources::<false>"
"<bun_runtime::api::h2_frame_parser_body::H2FrameParser>::rewrite_read"
)
NAMES=(receive finish_header_block handle_received_stream_id free_resources rewrite_read)
for b in rel-main rel-head; do
  for mode in server client; do
    for i in 0 1 2 3 4; do
      timeout 900 node run.cjs /tmp/h2repro/$b/bun-profile $mode "${SYMS[$i]}" 6 > $OUT/$b-$mode-${NAMES[$i]}.txt 2>&1
      echo "$b $mode ${NAMES[$i]} exit=$? lines=$(grep -c ICOUNT $OUT/$b-$mode-${NAMES[$i]}.txt)" >> $OUT/progress.txt
    done
  done
done
echo DONE >> $OUT/progress.txt
