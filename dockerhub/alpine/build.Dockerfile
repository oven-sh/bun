FROM alpine:edge AS build
WORKDIR /app/bun
ENV HOME=/root
COPY . .
RUN touch $HOME/.bashrc
RUN ./scripts/bootstrap.sh
RUN . $HOME/.bashrc && bun run build:release

RUN apk add file
RUN file ./build/release/bun
RUN ldd ./build/release/bun
RUN ./build/release/bun

WORKDIR /output
RUN cp -R /app/bun/build/* .

FROM scratch AS artifact
COPY --from=build /output /

# docker build -f ./dockerhub/alpine/build.Dockerfile --progress=plain --target=artifact --output type=local,dest=./build-alpine .
