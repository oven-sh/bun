#!/bin/bash

set -eo pipefail

function gen_cert {
    local path=$1
    local CN=$2
    local ca_path=$3
    local ca_name=${4:-ca}

    mkdir -p ${path}

    openssl genrsa -out ${path}/${CN}_key.pem 2048 >/dev/null
    echo "generated ${path}/${CN}_key.pem"

    openssl req -new -sha256 \
        -key ${path}/${CN}_key.pem \
        -subj "/O=uNetworking/O=uSockets/CN=${CN}" \
        -reqexts SAN \
        -config <(cat /etc/ssl/openssl.cnf \
            <(printf "\n[SAN]\nsubjectAltName=DNS:localhost,DNS:127.0.0.1")) \
        -out ${path}/${CN}.csr &>/dev/null
    
    if [ -z "${ca_path}" ]; then
        # self-signed
        openssl x509 -req -in ${path}/${CN}.csr \
            -signkey ${path}/${CN}_key.pem -days 365 -sha256 \
            -outform PEM -out ${path}/${CN}_crt.pem &>/dev/null
    
    else
        openssl x509 -req -in ${path}/${CN}.csr \
            -CA ${ca_path}/${ca_name}_crt.pem -CAkey ${ca_path}/${ca_name}_key.pem \
            -CAcreateserial -days 365 -sha256 \
            -outform PEM -out ${path}/${CN}_crt.pem &>/dev/null
    fi

    rm -f ${path}/${CN}.csr
    echo "generated ${path}/${CN}_crt.pem"
}

# main
certs=${1:-"/tmp/certs"}

gen_cert "${certs}" "valid_ca"
gen_cert "${certs}" "valid_server" "${certs}" "valid_ca"
gen_cert "${certs}" "valid_client" "${certs}" "valid_ca"

gen_cert "${certs}" "invalid_ca"
gen_cert "${certs}" "invalid_client" "${certs}" "invalid_ca"
gen_cert "${certs}" "selfsigned_client"

