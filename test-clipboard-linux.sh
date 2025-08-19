#!/bin/bash

# Script to run clipboard tests on Linux with xvfb
# This ensures clipboard utilities work in headless environments

set -e

# Find an available display number
DISPLAY_NUM=99
while [ -f "/tmp/.X${DISPLAY_NUM}-lock" ]; do
    DISPLAY_NUM=$((DISPLAY_NUM + 1))
    if [ $DISPLAY_NUM -gt 110 ]; then
        echo "Error: No available display found"
        exit 1
    fi
done

# Start xvfb if DISPLAY is not set or if we're in CI
if [ -z "$DISPLAY" ] || [ -n "$CI" ]; then
    echo "Starting xvfb on display :${DISPLAY_NUM}..."
    export DISPLAY=:${DISPLAY_NUM}
    Xvfb :${DISPLAY_NUM} -screen 0 1024x768x24 -ac +extension GLX +render -noreset > /dev/null 2>&1 &
    XVFB_PID=$!
    
    # Wait for xvfb to start
    sleep 3
    
    # Verify xvfb is running
    if ! kill -0 $XVFB_PID 2>/dev/null; then
        echo "Error: Failed to start xvfb"
        exit 1
    fi
    
    # Function to cleanup on exit
    cleanup() {
        if [ -n "$XVFB_PID" ]; then
            echo "Stopping xvfb..."
            kill $XVFB_PID 2>/dev/null || true
            wait $XVFB_PID 2>/dev/null || true
        fi
    }
    trap cleanup EXIT
else
    echo "Using existing DISPLAY=$DISPLAY"
fi

echo "Running clipboard tests with DISPLAY=$DISPLAY..."
exec "$@"