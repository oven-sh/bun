FROM alpine:edge AS build
ARG GIT_SHA
ENV GIT_SHA=${GIT_SHA}
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

RUN cp -R /app/bun/build/* /output

FROM scratch AS artifact
COPY --from=build /output /

# docker build -f ./ci/alpine/build.Dockerfile --progress=plain --build-arg GIT_SHA="$(git rev-parse HEAD)" --target=artifact --output type=local,dest=./build-alpine .
