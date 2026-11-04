console.log(await crypto.subtle.importKey("raw", new Uint8Array(16), "AES-GCM", true, ["encrypt"]));
