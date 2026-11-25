module.exports = function send(signal, event) {
  const taken = signal.dispatchEvent;
  taken(event);
};
