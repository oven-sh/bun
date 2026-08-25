#!/usr/bin/env bash
# Stand-in for the `ollama` CLI so the dispatcher can be tested without Ollama.
# Behaviour is driven by FAKE_* environment variables set by the test.
set -u
DIR="${FAKE_DIR:-/tmp}"

case "${1:-}" in
  --version)
    echo "ollama version is ${FAKE_VERSION:-0.15.2}"
    exit 0
    ;;
  list)
    printf 'NAME\tID\tSIZE\tMODIFIED\n'
    if [ -n "${FAKE_MODELS:-}" ]; then
      for m in ${FAKE_MODELS}; do printf '%s\tabc123\t4.7 GB\t2 days ago\n' "$m"; done
    fi
    exit 0
    ;;
  launch)
    if [ "${2:-}" = "--help" ]; then
      if [ -n "${FAKE_NO_LAUNCH:-}" ]; then
        echo 'Error: unknown command "launch" for "ollama"' >&2
        exit 1
      fi
      echo 'Usage: ollama launch [flags] <app> [-- <args>]'
      echo 'Flags:'
      echo '      --config         configure environment without launching'
      [ -z "${FAKE_NO_MODEL_FLAG:-}" ] && echo '      --model string   model to run the app against'
      [ -z "${FAKE_NO_YES_FLAG:-}" ] && echo '      --yes            skip interactive selectors'
      echo '      --               args after this are passed straight to the app'
      exit 0
    fi
    ;;
esac

# A real launch. Record the full argv (record-separated, since the prompt has newlines).
printf '%s\036' "$@" > "$DIR/inv-$$.args"

# Rendezvous mode: block until FAKE_PEERS agents are live at once, so the test can
# prove the pool really does (or does not) run agents in parallel. A marker is left
# behind on success (removing it could hide this agent from a peer still counting),
# so this only models one rendezvous group per run.
if [ -n "${FAKE_PEERS:-}" ]; then
  mkdir -p "$DIR/live"
  touch "$DIR/live/$$"
  waited=0
  cap="${FAKE_PEER_WAIT_MS:-5000}"
  while [ "$(ls "$DIR/live" | wc -l)" -lt "$FAKE_PEERS" ]; do
    if [ "$waited" -ge "$cap" ]; then rm -f "$DIR/live/$$"; exit 3; fi
    sleep 0.05
    waited=$((waited + 50))
  done
fi

# The first launch answers the planner when FAKE_PLAN is set; later ones act as agents.
if [ -n "${FAKE_PLAN:-}" ] && [ ! -e "$DIR/plan-used" ]; then
  touch "$DIR/plan-used"
  printf '%s\n' "$FAKE_PLAN"
  exit 0
fi

printf '%s\n' "${FAKE_STDOUT:-agent finished}"
[ -n "${FAKE_STDERR:-}" ] && printf '%s\n' "$FAKE_STDERR" >&2
exit "${FAKE_EXIT:-0}"
