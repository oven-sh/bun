// Angular's JIT compiler lets a standalone component bundle without the Angular CLI.
import "@angular/compiler";
import "zone.js";
import { Component } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";

struct Reading {
  label: string;
  celsius: number;
  constructor(label: string, celsius: number) {
    this.label = label;
    this.celsius = celsius;
  }
  fahrenheit(): number {
    return this.celsius * 1.8 + 32;
  }
}

@Component({
  selector: "app-root",
  standalone: true,
  template: `
    <h1>Readings</h1>
    <ul>
      @for (reading of readings; track reading.label) {
        <li>{{ reading.label }}: {{ reading.celsius }}°C / {{ reading.fahrenheit().toFixed(1) }}°F</li>
      }
    </ul>
    <button (click)="warmUp()">Warm everything up</button>
  `,
})
class AppComponent {
  readings: Reading[] = [new Reading("kitchen", 21), new Reading("garden", 14), new Reading("cellar", 9)];

  warmUp() {
    // Fields are writable, but the shape is fixed: a typo such as `reading.celcius = 1` throws.
    for (const reading of this.readings) reading.celsius += 1;
  }
}

bootstrapApplication(AppComponent).catch(error => console.error(error));
