module.exports = function send(signal, event, front) {
  const name = String.raw`${front}dispatchEvent`;
  const taken = signal[name];
  taken(event);
};
