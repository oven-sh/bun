function publish(holder, value) { holder.exports = value; }
publish(module, function () { return "published"; });
