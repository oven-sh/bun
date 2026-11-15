module.exports = function send(signal, event, front) {
  const name = `${front}dispatchEvent`;
  const taken = signal[name];
  taken(event);
};
