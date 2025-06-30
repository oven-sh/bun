# This script is sourced by the user and uses
# their shell. Try not to use tcshisms.

# Do not execute this script without sourcing,
# because it won't have any effect then.
# That is, always run this script with
#
#     source ./emsdk_env.csh
#
# instead of just plainly running with
#
#     ./emsdk_env.csh
#
# which won't have any effect.
set SRC=($_)
if ("$SRC" == "") then
  set SRC="$0"
else
  set SRC="$SRC[1]"
endif
set CURDIR=`pwd`
setenv DIR `dirname "$SRC"`
unset SRC

setenv EMSDK_CSH 1

eval `$DIR/emsdk construct_env`
unsetenv DIR

unsetenv EMSDK_CSH
