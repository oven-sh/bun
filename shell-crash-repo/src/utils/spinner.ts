export class Spinner {
  private message: string;
  
  constructor(message: string) {
    this.message = message;
  }
  
  start(): void {
    console.log(`⏳ ${this.message}...`);
  }
  
  stop(): void {
    console.log('✓ Done');
  }
}