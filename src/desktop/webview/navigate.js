async function navigate(url, method, type, body) {
  if (!type) return location[method](url);
  // Every byte is a character of it, so that what is sent is what was given.
  const acceptCharset = "windows-1252";
  const decode = bytes => new TextDecoder(acceptCharset).decode(bytes);
  const unescaped = it => decode(Uint8Array.from(unescape(it.replaceAll("+", " ")), it => it.charCodeAt()));
  const parse = async it => [...(await new Response(it, { headers: { "content-type": type } }).formData())];
  const [enctype] = type.split(";");
  const bytes = Uint8Array.fromBase64(body);
  const text = decode(bytes);
  let entries = [];
  if (enctype === "multipart/form-data") {
    const raw = await parse(bytes).catch(() => []);
    entries = (await parse(text).catch(() => [])).map(([name, value], at) => [name, value, raw[at][1]]);
  } else if (text && enctype === "text/plain") entries = [text.slice(0, -2).split(/=(.*)/s, 2)];
  else if (text) entries = text.split("&").map(it => it.split("=").map(unescaped));
  const create = (name, properties) => Object.assign(document.createElement(name), properties);
  const form = create("form", { method: "post", action: url, acceptCharset, enctype });
  for (const [name, value, contents] of entries) {
    if (typeof value === "string") form.append(create("textarea", { name, value }));
    else {
      const chosen = new DataTransfer();
      chosen.items.add(new File([contents], value.name, { type: value.type }));
      form.append(create("input", { name, type: "file", files: chosen.files }));
    }
  }
  document.body.append(form);
  HTMLFormElement.prototype.submit.call(form);
}
