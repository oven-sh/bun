ARG IMAGE=debian:11
FROM $IMAGE
COPY ./scripts/bootstrap.sh /tmp/bootstrap.sh
ENV CI=true
RUN sh /tmp/bootstrap.sh && rm -rf /tmp/*
