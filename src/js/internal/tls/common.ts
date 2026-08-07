// Translate some fields from the handle's C-friendly format into more idiomatic
// javascript object representations before passing them back to the user.  Can
// be used on any cert object, but changing the name would be semver-major.
function translatePeerCertificate(c) {
  if (!c) return null;

  if (c.issuerCertificate != null && c.issuerCertificate !== c) {
    c.issuerCertificate = translatePeerCertificate(c.issuerCertificate);
  }
  if (c.infoAccess != null) {
    const info = c.infoAccess;
    const parsed = (c.infoAccess = Object.create(null));

    // XXX: More key validation?
    info.replace(/([^\n:]*):([^\n]*)(?:\n|$)/g, (all, key, val) => {
      if (val.charCodeAt(0) === 0x22) {
        // Only used on internally created legacy cert objects; quoted values
        // are always valid JSON string literals, so this never throws.
        val = JSON.parse(val);
      }
      if (key in parsed) parsed[key].push(val);
      else parsed[key] = [val];
    });
  }
  return c;
}

export default {
  translatePeerCertificate,
};
