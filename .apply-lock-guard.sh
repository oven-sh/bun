#!/bin/bash
# Serialize Apply-phase agents on /root/bun-5 working tree.
# Usage: flock /root/bun-5/.apply-lock bash .apply-lock-guard.sh -- <command...>
exec "$@"
