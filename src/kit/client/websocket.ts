import { replaceModules } from '../hmr-module';
import { int } from '../macros' with { type: 'macro' };

const td = new TextDecoder();

const enum SocketState {
  Connecting,
  Connected,
}

let state = SocketState.Connecting;

export function initHmrWebSocket() {
  const ws = new WebSocket('/_bun/hmr');
  ws.binaryType = 'arraybuffer';
  ws.onopen = (ev) => {
    console.log('HMR socket open!');
    state = SocketState.Connected;
  }
  ws.onmessage = (ev: MessageEvent<string | ArrayBuffer>) => {
    const { data } = ev;
    if (typeof data === 'string') return data;
    const view = new DataView(data);
    // See hmr-protocol.md
    switch(view.getUint8(0)) {
      case int('V'): {
        console.log('VERSION', data);
        break;
      }
      case int('('): {
        const code = td.decode(data);
        const modules = (0, eval)(code);
        replaceModules(modules);
        break;
      }
      default: {
        location.reload();
        break;
      }
    }
  } 
  ws.onclose = (ev) => {
    // TODO: visual feedback in overlay.ts
    // TODO: reconnection
  }
  ws.onerror = (ev) => {
    console.error(ev);
  }
}
