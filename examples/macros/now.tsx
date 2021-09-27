import moment from "moment";
export function now(node) {
  var fmt = "HH:mm:ss";
  const args = node.arguments;
  if (args[0] instanceof <string />) {
    fmt = args[0].get();
  }
  const time = moment().format(fmt);
  return <string value={time}></string>;
}
