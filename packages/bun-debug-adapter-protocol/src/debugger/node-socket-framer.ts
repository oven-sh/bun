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
    socketFramerMessageLengthBuffer.writeUInt32BE(Buffer.byteLength(data), 0);
    this.socket.write(socketFramerMessageLengthBuffer);
    this.socket.write(data);
  }

  onData(data: Buffer): void {
    this.bufferedData = this.bufferedData.length > 0 ? Buffer.concat([this.bufferedData, data]) : data;

    let messagesToDeliver: string[] = [];
    let position = 0;

    while (position < this.bufferedData.length) {
      // Need 4 bytes for the length
      if (this.bufferedData.length - position < 4) {
        break;
      }

      // Read the length prefix
      const messageLength = this.bufferedData.readUInt32BE(position);

      // Validate message length
      if (messageLength <= 0 || messageLength > 1024 * 1024) {
        // 1MB max
        // Try to resync by looking for the next valid message
        let newPosition = position + 1;
        let found = false;

        while (newPosition < this.bufferedData.length - 4) {
          const testLength = this.bufferedData.readUInt32BE(newPosition);

          if (testLength > 0 && testLength <= 1024 * 1024) {
            // Verify we can read the full message
            if (this.bufferedData.length - newPosition - 4 >= testLength) {
              const testMessage = this.bufferedData.toString("utf-8", newPosition + 4, newPosition + 4 + testLength);

              if (testMessage.startsWith('{"')) {
                position = newPosition;
                found = true;
                break;
              }
            }
          }

          newPosition++;
        }

        if (!found) {
          // Couldn't find a valid message, discard buffer up to this point
          this.bufferedData = this.bufferedData.slice(position + 4);
          return;
        }

        continue;
      }

      // Check if we have the complete message
      if (this.bufferedData.length - position - 4 < messageLength) {
        break;
      }

      const message = this.bufferedData.toString("utf-8", position + 4, position + 4 + messageLength);
      if (message.startsWith('{"')) {
        messagesToDeliver.push(message);
      }

      position += 4 + messageLength;
    }

    if (position > 0) {
      this.bufferedData =
        position < this.bufferedData.length ? this.bufferedData.slice(position) : SocketFramer.emptyBuffer;
    }

    if (messagesToDeliver.length === 1) {
      this.onMessage(messagesToDeliver[0]);
    } else if (messagesToDeliver.length > 1) {
      this.onMessage(messagesToDeliver);
    }
  }

  private static emptyBuffer = Buffer.from([]);
}
