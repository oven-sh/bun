#!/bin/bash

set -euo pipefail

function ensure_secret() {
  local name=""
  local value=""
  name="$1"
  value="$(buildkite-agent secret get $name)"
  # If secret is not found, then we should exit with an error
  if [ -z "$value" ]; then
    echo "error: Secret $name not found"
    exit 1
  fi

  export "$name"="$value"
}

function optional_secret() {
  local name=""
  local value=""
  name="$1"
  value="$(buildkite-agent secret get $name) 2>/dev/null"

  export "$name"="$value"
}

ensure_secret "TLS_MONGODB_DATABASE_URL"
ensure_secret "TLS_POSTGRES_DATABASE_URL"
ensure_secret "TEST_INFO_STRIPE"
ensure_secret "TEST_INFO_AZURE_SERVICE_BUS"
optional_secret "SMTP_SENDGRID_KEY"
optional_secret "SMTP_SENDGRID_SENDER"
