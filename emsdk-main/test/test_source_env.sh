#!/usr/bin/env bash

echo "Test ability to source emsdk_env.sh in different shells"

if [ -n "$EMSDK" ]; then
    echo "EMSDK is already defined in this shell. Run tests in a shell without sourcing emsdk_env.sh first"
    exit 1
fi

DIR=$(dirname "$BASH_SOURCE")

# setup a symlink relative to the current dir
REL_LINK_DIR="$DIR/tmp"
if [ -d "$REL_LINK_DIR" ]; then
    rm -rf "$REL_LINK_DIR"
fi
echo "Creating links in $REL_LINK_DIR"
mkdir -p "$REL_LINK_DIR"
(cd $DIR/.. && ln -s `pwd` "$REL_LINK_DIR/emsdk")
(cd $DIR/.. && ln -s `pwd`/emsdk_env.sh "$REL_LINK_DIR")

# setup a symlink in an absolute directory
ABS_LINK_DIR="/tmp/emsdk_env_test"
if [ -d "$ABS_LINK_DIR" ]; then
    rm -rf "$ABS_LINK_DIR"
fi
echo "Creating links in $ABS_LINK_DIR"
mkdir -p "$ABS_LINK_DIR"
(cd $DIR/.. && ln -s `pwd` "$ABS_LINK_DIR/emsdk")
(cd $DIR/.. && ln -s `pwd`/emsdk_env.sh "$ABS_LINK_DIR")

PATH1="$DIR/../emsdk_env.sh"
PATH2="$REL_LINK_DIR/emsdk/emsdk_env.sh"
PATH3="$REL_LINK_DIR/emsdk_env.sh"
PATH4="$ABS_LINK_DIR/emsdk/emsdk_env.sh"
PATH5="$ABS_LINK_DIR/emsdk_env.sh"

assert_emcc() {
    current=$1
    cmd=$2
    value=$3
    if [ -z "$value" ] || [ "$value" == "false" ]; then
        echo "FAILED:  $current"
        echo "  unable to get EMSDK in $current using '$cmd'"
    else
        echo "SUCCESS: $current testing $cmd"
        echo "  -> EMSDK = $value"
    fi
}

test_bash() {
    value=$(bash --rcfile <(echo $1))
    assert_emcc bash "$1" "$value"
}

test_zsh() {
    value=$(zsh -d -c "$1")
    assert_emcc zsh "$1" "$value"
}

test_ksh() {
    value=$(ksh -c "$1")
    assert_emcc ksh "$1" "$value"
}

it_tests_direct_path() {
    TEST_SCRIPT=". ${PATH1}"' >/dev/null 2>&1; if [ -n "$EMSDK" ]; then echo "$EMSDK"; else echo false; fi ; exit'
    test_bash "$TEST_SCRIPT"
    test_zsh "$TEST_SCRIPT"
    test_ksh "$TEST_SCRIPT"
    TEST_SCRIPT="source ${PATH1}"' >/dev/null 2>&1; if [ -n "$EMSDK" ]; then echo "$EMSDK"; else echo false; fi ; exit'
    test_bash "$TEST_SCRIPT"
    test_zsh "$TEST_SCRIPT"
    test_ksh "$TEST_SCRIPT"
}

it_tests_via_relative_dir_symlink() {
    TEST_SCRIPT=". ${PATH2}"' >/dev/null 2>&1; if [ -n "$EMSDK" ]; then echo "$EMSDK"; else echo false; fi ; exit'
    test_bash "$TEST_SCRIPT"
    test_zsh "$TEST_SCRIPT"
    test_ksh "$TEST_SCRIPT"
    TEST_SCRIPT="source ${PATH2}"' >/dev/null 2>&1; if [ -n "$EMSDK" ]; then echo "$EMSDK"; else echo false; fi ; exit'
    test_bash "$TEST_SCRIPT"
    test_zsh "$TEST_SCRIPT"
    test_ksh "$TEST_SCRIPT"
}

it_tests_via_relative_file_symlink() {
    TEST_SCRIPT=". ${PATH3}"' >/dev/null 2>&1; if [ -n "$EMSDK" ]; then echo "$EMSDK"; else echo false; fi ; exit'
    test_bash "$TEST_SCRIPT"
    test_zsh "$TEST_SCRIPT"
    test_ksh "$TEST_SCRIPT"
    TEST_SCRIPT="source ${PATH3}"' >/dev/null 2>&1; if [ -n "$EMSDK" ]; then echo "$EMSDK"; else echo false; fi ; exit'
    test_bash "$TEST_SCRIPT"
    test_zsh "$TEST_SCRIPT"
    test_ksh "$TEST_SCRIPT"
}

it_tests_via_absolute_dir_symlink() {
    TEST_SCRIPT=". ${PATH4}"' >/dev/null 2>&1; if [ -n "$EMSDK" ]; then echo "$EMSDK"; else echo false; fi ; exit'
    test_bash "$TEST_SCRIPT"
    test_zsh "$TEST_SCRIPT"
    test_ksh "$TEST_SCRIPT"
    TEST_SCRIPT="source ${PATH4}"' >/dev/null 2>&1; if [ -n "$EMSDK" ]; then echo "$EMSDK"; else echo false; fi ; exit'
    test_bash "$TEST_SCRIPT"
    test_zsh "$TEST_SCRIPT"
    test_ksh "$TEST_SCRIPT"
}

it_tests_via_absolute_file_symlink() {
    TEST_SCRIPT=". ${PATH5}"' >/dev/null 2>&1; if [ -n "$EMSDK" ]; then echo "$EMSDK"; else echo false; fi ; exit'
    test_bash "$TEST_SCRIPT"
    test_zsh "$TEST_SCRIPT"
    test_ksh "$TEST_SCRIPT"
    TEST_SCRIPT="source ${PATH5}"' >/dev/null 2>&1; if [ -n "$EMSDK" ]; then echo "$EMSDK"; else echo false; fi ; exit'
    test_bash "$TEST_SCRIPT"
    test_zsh "$TEST_SCRIPT"
    test_ksh "$TEST_SCRIPT"
}

run_bash_tests() {
    it_tests_direct_path
    it_tests_via_relative_dir_symlink
    it_tests_via_relative_file_symlink
    it_tests_via_absolute_dir_symlink
    it_tests_via_absolute_file_symlink
}

run_bash_tests

rm -rf $REL_LINK_DIR
rm -rf $ABS_LINK_DIR
