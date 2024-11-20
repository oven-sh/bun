import type { Socket } from "node:net";
const enum FramerState {
  WaitingForLength,
  WaitingForMessage,
}

let socketFramerMessageLengthBuffer: Buffer;
export class SocketFramer {
  state: FramerState = FramerState.WaitingForLength;
  pendingLength: number = 0;
  sizeBuffer: Buffer = Buffer.alloc(4);
  sizeBufferIndex: number = 0;
  bufferedData: Buffer = Buffer.alloc(0);
  socket: Socket;
  private onMessage: (message: string | string[]) => void;

  constructor(socket: Socket, onMessage: (message: string | string[]) => void) {
    this.socket = socket;
    this.onMessage = onMessage;

    if (!socketFramerMessageLengthBuffer) {
      socketFramerMessageLengthBuffer = Buffer.alloc(4);
    }

    this.reset();
  }

  reset(): void {
    this.state = FramerState.WaitingForLength;
    this.bufferedData = Buffer.alloc(0);
    this.sizeBufferIndex = 0;
    this.sizeBuffer = Buffer.alloc(4);
  }

  send(data: string): void {
    socketFramerMessageLengthBuffer.writeUInt32BE(data.length, 0);
    this.socket.write(socketFramerMessageLengthBuffer);
    this.socket.write(data);
  }

  onData(data: Buffer): void {
    this.bufferedData = this.bufferedData.length > 0 ? Buffer.concat([this.bufferedData, data]) : data;

    let messagesToDeliver: string[] = [];

    while (this.bufferedData.length > 0) {
      if (this.state === FramerState.WaitingForLength) {
        if (this.sizeBufferIndex + this.bufferedData.length < 4) {
          const remainingBytes = Math.min(4 - this.sizeBufferIndex, this.bufferedData.length);
          this.bufferedData.copy(this.sizeBuffer, this.sizeBufferIndex, 0, remainingBytes);
          this.sizeBufferIndex += remainingBytes;
          this.bufferedData = this.bufferedData.slice(remainingBytes);
          break;
        }

        const remainingBytes = 4 - this.sizeBufferIndex;
        this.bufferedData.copy(this.sizeBuffer, this.sizeBufferIndex, 0, remainingBytes);
        this.pendingLength = this.sizeBuffer.readUInt32BE(0);

        this.state = FramerState.WaitingForMessage;
        this.sizeBufferIndex = 0;
        this.bufferedData = this.bufferedData.slice(remainingBytes);
      }

      if (this.bufferedData.length < this.pendingLength) {
        break;
      }

      const message = this.bufferedData.toString("utf-8", 0, this.pendingLength);
      this.bufferedData = this.bufferedData.slice(this.pendingLength);
      this.state = FramerState.WaitingForLength;
      this.pendingLength = 0;
      this.sizeBufferIndex = 0;
      messagesToDeliver.push(message);
    }

    if (messagesToDeliver.length === 1) {
      this.onMessage(messagesToDeliver[0]);
    } else if (messagesToDeliver.length > 1) {
      this.onMessage(messagesToDeliver);
    }
  }
}
