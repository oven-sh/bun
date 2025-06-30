# Dockerfile for EMSDK

This Dockerfile builds a self-contained version of Emscripten SDK that enables Emscripten to be used without any
other installation on the host system.

It is published at https://hub.docker.com/r/emscripten/emsdk.

### Usage

Simple usage of this container to compile a hello-world
```bash
# create helloworld.cpp
cat << EOF > helloworld.cpp
#include <iostream>
int main() {
  std::cout << "Hello World!" << std::endl;
  return 0;
}
EOF
```

```bash
# compile with docker image
docker run \
  --rm \
  -v "$(pwd):$(pwd)" \
  -u $(id -u):$(id -g) \
  emscripten/emsdk \
  emcc helloworld.cpp -o helloworld.js

# execute on host machine
node helloworld.js
```

Teardown of compilation command:

|part|description|
|---|---|
|`docker run`| A standard command to run a command in a container|
|`--rm`|remove a container after execution (optimization)|
|`-v "$(pwd):$(pwd)"`|Mounting current folder from the host system into mirrored path on the container<br>TIP: This helps to investigate possible problem as we preserve exactly the same paths like in host. In such case modern editors (like Sublime, Atom, VS Code) let us to CTRL+Click on a problematic file |
|`-u $(id -u):$(id -g)`| Run the container as a non-root user with the same UID and GID as local user. Hence all files produced by this are accessible to non-root users|
|`emscripten/emsdk`|Get the latest tag of this container|
|`emcc helloworld.cpp -o helloworld.js`|Execute `emcc` command with following arguments inside container, effectively compile our source code|



### Building Dockerfile

This image has following optional arguments

| arg | default value | description |
| --- | --- | --- |
| `EMSCRIPTEN_VERSION` | `tot`<br/>(special case, tip-of-tree) | One of released version of Emscripten. For example `2.0.0`<br/> Minimal supported version is **1.39.0** |

**Building**

This step will build Dockerfile as given tag on local machine
```bash
# using docker
docker build \
    --network host \
    --build-arg=EMSCRIPTEN_VERSION=1.39.17 \
    -t emscripten/emsdk:1.39.17 \
    -f docker/Dockerfile \
    .
```
```bash
# using predefined make target
make version=1.39.17 build test
```

**Tagging**

In case of using `docker build` command directly, given `--tag` should match version of released Emscripten (you can see list of non-legacy versions by executing `emsdk list`).

**Pushing**

This step will take local image and push to default docker registry. You need to make sure that you logged in docker cli (`docker login`) and you have rights to push to that registry.

```bash
# using docker
docker push emscripten/emsdk:1.39.17
```
```bash
# using predefined make target
make version=1.39.17 push
```

In case of pushing the most recent version, this version should be also tagged as `latest` and pushed.
```bash
# using docker cli
docker tag emscripten/emsdk:1.39.17 emscripten/emsdk:latest
docker push emscripten/emsdk:latest

```bash
# using make
make version=1.39.17 alias=latest push
```

### Extending

If your project uses packages that this image doesn't provide you might want to:
* Contribute to this repo: Maybe your dependency is either non-intrusive or could be useful for other people
* Create custom image that bases on this image

1. create own Dockerfile that holds:
    ```dockerfile
    # Point at any base image that you find suitable to extend.
    FROM emscripten/emsdk:1.39.17

    # Install required tools that are useful for your project i.e. ninja-build
    RUN apt update && apt install -y ninja-build
    ```

2. build it
    ```bash
    docker build -t extended_emscripten .
    ```

3. test
    ```bash
    docker run --rm extended_emscripten ninja --version
    # 1.10.0
    ```
