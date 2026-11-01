const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;
function format(bytes) {
  if (bytes >= GB) return (bytes / GB).toFixed(1) + " GB";
  if (bytes >= MB) return (bytes / MB).toFixed(1) + " MB";
  if (bytes >= KB) return (bytes / KB).toFixed(1) + " KB";
  return bytes + " B";
}
console.log(format(512), format(1536), format(5 * MB), format(3.5 * GB));
