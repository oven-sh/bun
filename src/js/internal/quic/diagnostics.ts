// Ported from Node.js lib/internal/quic/diagnostics.js (v26.3.0).
const { builtinChannel } = require("internal/shared");

const onEndpointCreatedChannel = builtinChannel("quic.endpoint.created");
const onEndpointListeningChannel = builtinChannel("quic.endpoint.listen");
const onEndpointClosingChannel = builtinChannel("quic.endpoint.closing");
const onEndpointClosedChannel = builtinChannel("quic.endpoint.closed");
const onEndpointErrorChannel = builtinChannel("quic.endpoint.error");
const onEndpointBusyChangeChannel = builtinChannel("quic.endpoint.busy.change");
const onEndpointClientSessionChannel = builtinChannel("quic.session.created.client");
const onEndpointServerSessionChannel = builtinChannel("quic.session.created.server");
const onSessionOpenStreamChannel = builtinChannel("quic.session.open.stream");
const onSessionReceivedStreamChannel = builtinChannel("quic.session.received.stream");
const onSessionSendDatagramChannel = builtinChannel("quic.session.send.datagram");
const onSessionUpdateKeyChannel = builtinChannel("quic.session.update.key");
const onSessionClosingChannel = builtinChannel("quic.session.closing");
const onSessionClosedChannel = builtinChannel("quic.session.closed");
const onSessionReceiveDatagramChannel = builtinChannel("quic.session.receive.datagram");
const onSessionReceiveDatagramStatusChannel = builtinChannel("quic.session.receive.datagram.status");
const onSessionPathValidationChannel = builtinChannel("quic.session.path.validation");
const onSessionNewTokenChannel = builtinChannel("quic.session.new.token");
const onSessionTicketChannel = builtinChannel("quic.session.ticket");
const onSessionVersionNegotiationChannel = builtinChannel("quic.session.version.negotiation");
const onSessionOriginChannel = builtinChannel("quic.session.receive.origin");
const onSessionHandshakeChannel = builtinChannel("quic.session.handshake");
const onSessionGoawayChannel = builtinChannel("quic.session.goaway");
const onSessionEarlyRejectedChannel = builtinChannel("quic.session.early.rejected");
const onStreamClosedChannel = builtinChannel("quic.stream.closed");
const onStreamHeadersChannel = builtinChannel("quic.stream.headers");
const onStreamTrailersChannel = builtinChannel("quic.stream.trailers");
const onStreamInfoChannel = builtinChannel("quic.stream.info");
const onStreamResetChannel = builtinChannel("quic.stream.reset");
const onStreamBlockedChannel = builtinChannel("quic.stream.blocked");
const onSessionErrorChannel = builtinChannel("quic.session.error");
const onEndpointConnectChannel = builtinChannel("quic.endpoint.connect");

export default {
  onEndpointCreatedChannel,
  onEndpointListeningChannel,
  onEndpointClosingChannel,
  onEndpointClosedChannel,
  onEndpointErrorChannel,
  onEndpointBusyChangeChannel,
  onEndpointClientSessionChannel,
  onEndpointServerSessionChannel,
  onSessionOpenStreamChannel,
  onSessionReceivedStreamChannel,
  onSessionSendDatagramChannel,
  onSessionUpdateKeyChannel,
  onSessionClosingChannel,
  onSessionClosedChannel,
  onSessionReceiveDatagramChannel,
  onSessionReceiveDatagramStatusChannel,
  onSessionPathValidationChannel,
  onSessionNewTokenChannel,
  onSessionTicketChannel,
  onSessionVersionNegotiationChannel,
  onSessionOriginChannel,
  onSessionHandshakeChannel,
  onSessionGoawayChannel,
  onSessionEarlyRejectedChannel,
  onStreamClosedChannel,
  onStreamHeadersChannel,
  onStreamTrailersChannel,
  onStreamInfoChannel,
  onStreamResetChannel,
  onStreamBlockedChannel,
  onSessionErrorChannel,
  onEndpointConnectChannel,
};
