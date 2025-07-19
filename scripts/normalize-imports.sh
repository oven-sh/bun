#!/bin/sh
set -euf

case "${1-}" in
    ""|-h|--help)
        printf >&2 '%s\n' "usage: $(basename -- "$0") <path-to-src>"
        exit 1
        ;;
esac

IFS='
'

unset tmp

cleanup() {
    local status=$?
    trap - HUP INT QUIT TERM EXIT
    if [ -n "${tmp-}" ]; then
        rm -f -- "$tmp"
    fi
    exit "$status"
}

trap cleanup HUP INT QUIT TERM EXIT
tmp=$(mktemp)

for f in $(find "$1" -type f -name '*.zig' ! -path '*/deps/*' ! -name '*
*'); do
    grep -q '@import("[A-Za-z][^"]*.zig")' "$f" || continue
    DIR=$(dirname "$f") awk > "$tmp" '
        BEGIN {
            pattern = "@import\(\"[A-Za-z][A-Za-z0-9./_-]*\"\)"
        }

        function normalize() {
            if (!match($0, pattern)) return
            matched = substr($0, RSTART, RLENGTH)
            split(matched, parts, /"/);
            path = parts[2]
            if (path !~ /\.zig$/) return
            if (!system("[ -f \"${DIR}" path "\" ]")) return
            sub(pattern, "@import(\"./" path "\")")
        }

        {
            normalize()
            print
        }
    ' "$f"
    cp -T -- "$tmp" "$f"
done
