const string = []const u8;
const sigstore = @import("../sigstore/provenance_generator.zig");

pub const ProvenanceError = error{
    UnsupportedCIProvider,
    MissingCIEnvironment,
    PublicAccessRequired,
    TokenAcquisitionFailed,
    CertificateRequestFailed,
    SigningFailed,
    TransparencyLogFailed,
    OutOfMemory,
};

pub const ProvenanceGenerator = struct {
    allocator: std.mem.Allocator,
    sigstore_generator: sigstore.SigstoreProvenanceGenerator,

    pub fn init(allocator: std.mem.Allocator) ProvenanceGenerator {
        const sigstore_generator = sigstore.createProvenanceGenerator(allocator, null, null) catch {
            // This should only fail if the allocator is out of memory
            @panic("Failed to create provenance generator");
        };
        
        return .{
            .allocator = allocator,
            .sigstore_generator = sigstore_generator,
        };
    }

    pub fn deinit(self: *ProvenanceGenerator) void {
        self.sigstore_generator.deinit();
    }

    pub fn ensureProvenanceGeneration(
        self: *const ProvenanceGenerator,
        access: ?[]const u8,
    ) ProvenanceError!void {
        return self.sigstore_generator.ensureProvenanceGeneration(access) catch |err| switch (err) {
            sigstore.ProvenanceError.UnsupportedCIProvider => ProvenanceError.UnsupportedCIProvider,
            sigstore.ProvenanceError.MissingCIEnvironment => ProvenanceError.MissingCIEnvironment,
            sigstore.ProvenanceError.PublicAccessRequired => ProvenanceError.PublicAccessRequired,
            sigstore.ProvenanceError.TokenAcquisitionFailed => ProvenanceError.TokenAcquisitionFailed,
            sigstore.ProvenanceError.CertificateRequestFailed => ProvenanceError.CertificateRequestFailed,
            sigstore.ProvenanceError.SigningFailed => ProvenanceError.SigningFailed,
            sigstore.ProvenanceError.TransparencyLogFailed => ProvenanceError.TransparencyLogFailed,
            sigstore.ProvenanceError.OutOfMemory => ProvenanceError.OutOfMemory,
        };
    }

    pub fn generateProvenanceBundle(
        self: *const ProvenanceGenerator,
        package_name: string,
        package_version: string,
        integrity_sha512: []const u8,
    ) ProvenanceError![]const u8 {
        return self.sigstore_generator.generateProvenanceBundle(package_name, package_version, integrity_sha512) catch |err| switch (err) {
            sigstore.ProvenanceError.UnsupportedCIProvider => ProvenanceError.UnsupportedCIProvider,
            sigstore.ProvenanceError.MissingCIEnvironment => ProvenanceError.MissingCIEnvironment,
            sigstore.ProvenanceError.PublicAccessRequired => ProvenanceError.PublicAccessRequired,
            sigstore.ProvenanceError.TokenAcquisitionFailed => ProvenanceError.TokenAcquisitionFailed,
            sigstore.ProvenanceError.CertificateRequestFailed => ProvenanceError.CertificateRequestFailed,
            sigstore.ProvenanceError.SigningFailed => ProvenanceError.SigningFailed,
            sigstore.ProvenanceError.TransparencyLogFailed => ProvenanceError.TransparencyLogFailed,
            sigstore.ProvenanceError.OutOfMemory => ProvenanceError.OutOfMemory,
        };
    }
};

const bun = @import("bun");
const std = @import("std");