import { RequestHandler } from 'slash-create';
import { MultipartData } from 'slash-create/lib/util/multipartData.js';

export class FetchRequestHandler extends RequestHandler {
  toString() {
    return '[RequestHandler]';
  }

  async request(method, url, auth = true, body, file) {
    const creator = this._creator;

    const headers = {
      'user-agent': this.userAgent,
      'x-ratelimit-precision': 'millisecond',
    };

    if (auth) {
      headers.authorization = creator.options.token;
      if (!headers.authorization) throw new Error('No token was set in the SlashCreator.');
    }

    if (body) {
      if (method !== 'GET' && method !== 'DELETE') {
        body = JSON.stringify(body);
        headers['content-type'] = 'application/json';
      }
    }

    if (file) {
      if (Array.isArray(file)) {}
      else if (file.file) file = [file];
      else throw new Error('Invalid file object.');

      const form = new MultipartData();
      headers['content-type'] = `multipart/form-data; boundary=${form.boundary}`;

      for (const f of file) form.attach(f.name, f.file, f.name);
      if (body) form.attach('payload_json', JSON.stringify(body));

      body = Buffer.concat(form.finish());
    }

    const res = await fetch('https://discord.com' + this.baseURL + url, { body, method, headers });

    if (res.ok) return res.json();
    throw new Error(`${method} got ${res.status} - ${await res.text()}`);
  }
}