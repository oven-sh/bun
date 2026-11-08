const kept = Math.floor;
Math.floor = () => 55;
module.exports = () => {
  Math.floor = kept;
};
