#!/usr/bin/env bash

echo "Running next at 24ms"
PROJECT=next SLEEP_INTERVAL=24 make generate &
PROJECT=next SLEEP_INTERVAL=24 make loop
killall Chromium || echo "";
PROJECT=next SLEEP_INTERVAL=24 make process_video
PROJECT=next SLEEP_INTERVAL=24 make frames -j$(nproc)
PROJECT=next SLEEP_INTERVAL=24 make trim
cp src/colors.css.blob next/colors.css.blob
PROJECT=next SLEEP_INTERVAL=24 make print > "next.latest.24ms.txt"

echo "Running bun at 24ms"
PROJECT=bun SLEEP_INTERVAL=24 make generate &
PROJECT=bun SLEEP_INTERVAL=24 make loop
killall Chromium || echo "";
PROJECT=bun SLEEP_INTERVAL=24 make process_video
PROJECT=bun SLEEP_INTERVAL=24 make frames -j$(nproc)
PROJECT=bun SLEEP_INTERVAL=24 make trim
cp src/colors.css.blob bun/colors.css.blob
PROJECT=bun SLEEP_INTERVAL=24 make print > "bun.latest.24ms.txt"

echo "Running next at 16ms"
PROJECT=next SLEEP_INTERVAL=16 make generate &
PROJECT=next SLEEP_INTERVAL=16 make loop
killall Chromium || echo "";
PROJECT=next SLEEP_INTERVAL=16 make process_video
PROJECT=next SLEEP_INTERVAL=16 make frames -j$(nproc)
PROJECT=next SLEEP_INTERVAL=16 make trim
cp src/colors.css.blob next/colors.css.blob
PROJECT=next SLEEP_INTERVAL=16 make print > "next.latest.16ms.txt"

echo "Running bun at 16ms"
PROJECT=bun SLEEP_INTERVAL=16 make generate &
PROJECT=bun SLEEP_INTERVAL=16 make loop
killall Chromium || echo "";
PROJECT=bun SLEEP_INTERVAL=16 make process_video
PROJECT=bun SLEEP_INTERVAL=16 make frames -j$(nproc)
PROJECT=bun SLEEP_INTERVAL=16 make trim
cp src/colors.css.blob bun/colors.css.blob
PROJECT=bun SLEEP_INTERVAL=16 make print > "bun.latest.16ms.txt"

echo "Running bun at 8ms"
PROJECT=bun SLEEP_INTERVAL=8 make generate &
PROJECT=bun SLEEP_INTERVAL=8 make loop
killall Chromium || echo "";
PROJECT=bun SLEEP_INTERVAL=8 make process_video
PROJECT=bun SLEEP_INTERVAL=8 make frames -j$(nproc)
PROJECT=bun SLEEP_INTERVAL=8 make trim
cp src/colors.css.blob bun/colors.css.blob
PROJECT=bun SLEEP_INTERVAL=8 make print > "bun.latest.8ms.txt"


echo "Running next at 8ms"
PROJECT=next SLEEP_INTERVAL=8 make generate &
PROJECT=next SLEEP_INTERVAL=8 make loop
killall Chromium || echo "";
PROJECT=next SLEEP_INTERVAL=8 make process_video
PROJECT=next SLEEP_INTERVAL=8 make frames -j$(nproc)
PROJECT=next SLEEP_INTERVAL=8 make trim
cp src/colors.css.blob next/colors.css.blob
PROJECT=next SLEEP_INTERVAL=8 make print > "next.latest.8ms.txt"

echo "Running bun at 32ms"
PROJECT=bun SLEEP_INTERVAL=32 make generate &
PROJECT=bun SLEEP_INTERVAL=32 make loop
killall Chromium || echo "";
PROJECT=bun SLEEP_INTERVAL=32 make process_video
PROJECT=bun SLEEP_INTERVAL=32 make frames -j$(nproc)
PROJECT=bun SLEEP_INTERVAL=32 make trim
cp src/colors.css.blob bun/colors.css.blob
PROJECT=bun SLEEP_INTERVAL=32 make print > "bun.latest.32ms.txt"

echo "Running next at 32ms"
PROJECT=next SLEEP_INTERVAL=32 make generate &
PROJECT=next SLEEP_INTERVAL=32 make loop
killall Chromium || echo "";
PROJECT=next SLEEP_INTERVAL=32 make process_video
PROJECT=next SLEEP_INTERVAL=32 make frames -j$(nproc)
PROJECT=next SLEEP_INTERVAL=32 make trim
cp src/colors.css.blob next/colors.css.blob
PROJECT=next SLEEP_INTERVAL=32 make print > "next.latest.32ms.txt"

