#!/bin/bash

# Signs the macOS binaries of a release with Bun's Developer ID certificate, and
# uploads the zips again under the same names.
#
#   sign-darwin-artifacts.sh <zip>=<key of the step that built it>...

set -euo pipefail

team_id="7FRXF46ZSN"
repository="$PWD"
work="$(mktemp -d)"
keychain="$work/signing.keychain-db"
trap 'security delete-keychain "$keychain" 2> /dev/null || true; rm -rf "$work"' EXIT

function import_identity() {
  local keychain_password certificate_password authority
  keychain_password="$(uuidgen)"
  security create-keychain -p "$keychain_password" "$keychain"
  security set-keychain-settings "$keychain" # never lock
  security unlock-keychain -p "$keychain_password" "$keychain"

  # codesign needs the certificate's issuer, which the .p12 does not carry.
  for authority in DeveloperIDCA DeveloperIDG2CA; do
    curl -fsSL --retry 3 -o "$work/$authority.cer" "https://www.apple.com/certificateauthority/$authority.cer"
    security import "$work/$authority.cer" -k "$keychain"
  done

  buildkite-agent secret get APPLE_DEVELOPER_ID_P12_BASE64 | base64 --decode > "$work/identity.p12"
  certificate_password="$(buildkite-agent secret get APPLE_DEVELOPER_ID_P12_PASSWORD)"
  security import "$work/identity.p12" -k "$keychain" -f pkcs12 -P "$certificate_password" -T /usr/bin/codesign
  rm "$work/identity.p12"

  # Without this, codesign waits on a keychain prompt.
  security set-key-partition-list -S apple-tool:,apple: -s -k "$keychain_password" "$keychain" > /dev/null
  security list-keychains -d user -s "$keychain"
}

function verify() {
  local binary="$1" details expected
  # What earlier releases are signed as, so macOS takes this binary for the same program.
  codesign --verify --strict --verbose=2 --test-requirement="=identifier \"${binary##*/}\" \
    and anchor apple generic \
    and certificate 1[field.1.2.840.113635.100.6.2.6] exists \
    and certificate leaf[field.1.2.840.113635.100.6.1.13] exists \
    and certificate leaf[subject.OU] = \"$team_id\"" "$binary"

  details="$(codesign --display --verbose=3 "$binary" 2>&1)"
  echo "$details"
  for expected in "flags=0x10000(runtime)" "Hash type=sha256" "Timestamp="; do
    if [[ "$details" != *"$expected"* ]]; then
      echo "error: The signature of $binary does not have $expected"
      exit 1
    fi
  done
}

function smoke_test() {
  local binary="$1" expected actual
  expected="${BUILDKITE_BRANCH#release/bun-v}+${BUILDKITE_COMMIT:0:9}"
  actual="$("$binary" --revision)"
  if [ "$actual" != "$expected" ]; then
    echo "error: $binary --revision printed $actual, expected $expected"
    exit 1
  fi
  # `--compile` edits a copy of the binary, signature included.
  echo 'console.log("ok")' > "$work/smoke.js"
  "$binary" build --compile "$work/smoke.js" --outfile "$work/smoke"
  "$work/smoke"
}

echo "--- Importing the certificate"
import_identity

cd "$work"
for argument in "$@"; do
  zip="${argument%%=*}"
  step="${argument#*=}"
  directory="${zip%.zip}"
  if [[ "$directory" == *-profile ]]; then
    binary="$directory/bun-profile"
    entitlements="$repository/.buildkite/scripts/entitlements.profile.plist"
  else
    binary="$directory/bun"
    entitlements="$repository/entitlements.plist"
  fi

  echo "--- Signing $zip"
  buildkite-agent artifact download "$zip" . --step "$step"
  unzip -q "$zip"
  rm "$zip"
  codesign --entitlements "$entitlements" --options runtime --force --timestamp -vvvv --deep --strict \
    --keychain "$keychain" --sign "Developer ID Application" "$binary"
  verify "$binary"
  if [[ "$directory" == bun-darwin-aarch64* ]]; then
    smoke_test "$binary"
  fi
  ditto -ck --rsrc --sequesterRsrc --keepParent "$directory" "$zip"
  buildkite-agent artifact upload "$zip"
  rm -rf "$directory" "$zip"
done
