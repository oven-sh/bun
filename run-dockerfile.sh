#!/bin/bash

source "dockerfile-common.sh"

export $CONTAINER_NAME=$CONTAINER_NAME-local

rm -rf $TEMP
mkdir -p $TEMP

docker build . --target release --progress=plain -t $CONTAINER_NAME:latest --build-arg BUILDKIT_INLINE_CACHE=1 --platform=linux/$BUILDKIT_ARCH --cache-from $CONTAINER_NAME:latest

if (($?)); then
  echo "Failed to build container"
  exit 1
fi

id=$(docker create $CONTAINER_NAME:latest)
docker cp $id:/home/ubuntu/bun-release $TEMP/$CONTAINER_NAME
if (($?)); then
  echo "Failed to cp container"
  exit 1
fi

cd $TEMP
mkdir -p $TEMP/$CONTAINER_NAME $TEMP/$DEBUG_CONTAINER_NAME
mv $CONTAINER_NAME/bun-profile $DEBUG_CONTAINER_NAME/bun
zip -r $CONTAINER_NAME.zip $CONTAINER_NAME
zip -r $DEBUG_CONTAINER_NAME.zip $DEBUG_CONTAINER_NAME
docker rm -v $id
abs=$(realpath $TEMP/$CONTAINER_NAME.zip)
debug_abs=$(realpath $TEMP/$DEBUG_CONTAINER_NAME.zip)

case $(uname -s) in
"Linux") target="linux" ;;
*) target="other" ;;
esac

if [ "$target" = "linux" ]; then
  if command -v bun --version >/dev/null; then
    cp $TEMP/$CONTAINER_NAME/bun $(which bun)
    cp $TEMP/$DEBUG_CONTAINER_NAME/bun $(which bun-profile)
  fi
fi

echo "Saved to:"
echo $debug_abs
echo $abs
