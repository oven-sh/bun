/**
 * Test helper for temporarily setting telemetry configuration properties.
 *
 * Uses the `using` declaration pattern to automatically restore original values
 * when the scope exits, preventing test pollution.
 *
 * @example
 * ```typescript
 * import { ConfigurationProperty } from "../types";
 * import { TempConfig } from "./config-helper";
 *
 * test("my test", () => {
 *   using config = new TempConfig({
 *     [ConfigurationProperty.http_capture_headers_fetch_request]: ["content-type"],
 *     [ConfigurationProperty.http_capture_headers_fetch_response]: ["content-length"],
 *   });
 *
 *   // Test code here - config is automatically restored at end of scope
 * });
 * ```
 */

import { ConfigurationProperty } from "../types";

export class TempConfig {
  private originalValues: Map<ConfigurationProperty, any> = new Map();

  constructor(config: Partial<Record<ConfigurationProperty, any>>) {
    // Save original values and set new ones
    for (const [key, value] of Object.entries(config)) {
      const propertyId = Number(key) as ConfigurationProperty;

      // Skip RESERVED property
      if (propertyId === ConfigurationProperty.RESERVED) {
        continue;
      }

      // Save original value
      const originalValue = Bun.telemetry.nativeHooks.getConfigurationProperty(propertyId);
      this.originalValues.set(propertyId, originalValue);

      // Set new value
      Bun.telemetry.nativeHooks.setConfigurationProperty(propertyId, value);
    }
  }

  /**
   * Restore original configuration values.
   * Called automatically when using `using` declaration.
   */
  [Symbol.dispose](): void {
    // Restore all original values
    for (const [propertyId, originalValue] of this.originalValues.entries()) {
      Bun.telemetry.nativeHooks.setConfigurationProperty(propertyId, originalValue);
    }
    this.originalValues.clear();
  }
}
