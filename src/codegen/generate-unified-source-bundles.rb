# Copyright (C) 2017 Apple Inc. All rights reserved.
#
# Redistribution and use in source and binary forms, with or without
# modification, are permitted provided that the following conditions
# are met:
# 1. Redistributions of source code must retain the above copyright
#    notice, this list of conditions and the following disclaimer.
# 2. Redistributions in binary form must reproduce the above copyright
#    notice, this list of conditions and the following disclaimer in the
#    documentation and/or other materials provided with the distribution.
#
# THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
# AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
# THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
# PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
# BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
# CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
# SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
# INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
# CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
# ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
# THE POSSIBILITY OF SUCH DAMAGE.

require 'digest'
require 'fileutils'
require 'pathname'
require 'getoptlong'

SCRIPT_NAME = File.basename($0)
COMMENT_REGEXP = /\/\//

def usage(message)
    if message
        puts "Error: #{message}"
        puts
    end

    puts "usage: #{SCRIPT_NAME} [options] <sources-list-file>..."
    puts "<sources-list-file> may be separate arguments or one semicolon separated string"
    puts "--help                          (-h) Print this message"
    puts "--verbose                       (-v) Adds extra logging to stderr."
    puts
    puts "Required arguments:"
    puts "--source-tree-path              (-s) Path to the root of the source directory."
    puts "--derived-sources-path          (-d) Path to the directory where the unified source files should be placed."
    puts
    puts "Optional arguments:"
    puts "--print-bundled-sources              Print bundled sources rather than generating sources"
    puts "--print-all-sources                  Print all sources rather than generating sources"
    puts "--generate-xcfilelists               Generate .xcfilelist files"
    puts "--input-xcfilelist-path              Path of the generated input .xcfilelist file"
    puts "--output-xcfilelist-path             Path of the generated output .xcfilelist file"
    puts
    puts "Generation options:"
    puts "--max-cpp-bundle-count               Use global sequential numbers for cpp bundle filenames and set the limit on the number"
    puts "--max-c-bundle-count                 Use global sequential numbers for c bundle filenames and set the limit on the number"
    puts "--max-obj-c-bundle-count             Use global sequential numbers for Obj-C bundle filenames and set the limit on the number"
    puts "--max-bundle-size                    The number of files to merge into a single bundle"
    puts "--dense-bundle-filter                Densely bundle files matching the given path glob"
    exit 1
end

MAX_DENSE_BUNDLE_SIZE = 64
$derivedSourcesPath = nil
$unifiedSourceOutputPath = nil
$sourceTreePath = nil
$verbose = false
$mode = :GenerateBundles
$inputXCFilelistPath = nil
$outputXCFilelistPath = nil
$maxCppBundleCount = nil
$maxCBundleCount = nil
$maxObjCBundleCount = nil
$maxBundleSize = 8
$denseBundleFilters = []
$bundleFilenamePrefix = ''

def log(text)
    $stderr.puts text if $verbose
end

GetoptLong.new(['--help', '-h', GetoptLong::NO_ARGUMENT],
               ['--verbose', '-v', GetoptLong::NO_ARGUMENT],
               ['--derived-sources-path', '-d', GetoptLong::REQUIRED_ARGUMENT],
               ['--source-tree-path', '-s', GetoptLong::REQUIRED_ARGUMENT],
               ['--print-bundled-sources', GetoptLong::NO_ARGUMENT],
               ['--print-all-sources', GetoptLong::NO_ARGUMENT],
               ['--generate-xcfilelists', GetoptLong::NO_ARGUMENT],
               ['--input-xcfilelist-path', GetoptLong::REQUIRED_ARGUMENT],
               ['--output-xcfilelist-path', GetoptLong::REQUIRED_ARGUMENT],
               ['--max-cpp-bundle-count', GetoptLong::REQUIRED_ARGUMENT],
               ['--max-c-bundle-count', GetoptLong::REQUIRED_ARGUMENT],
               ['--max-obj-c-bundle-count', GetoptLong::REQUIRED_ARGUMENT],
               ['--max-bundle-size', GetoptLong::REQUIRED_ARGUMENT],
               ['--dense-bundle-filter', GetoptLong::REQUIRED_ARGUMENT],
               ['--bundle-filename-prefix', GetoptLong::REQUIRED_ARGUMENT]).each {
    | opt, arg |
    case opt
    when '--help'
        usage(nil)
    when '--verbose'
        $verbose = true
    when '--derived-sources-path'
        $derivedSourcesPath = Pathname.new(arg)
    when '--source-tree-path'
        $sourceTreePath = Pathname.new(arg)
        usage("Source tree #{arg} does not exist.") if !$sourceTreePath.exist?
    when '--print-bundled-sources'
        $mode = :PrintBundledSources
    when '--print-all-sources'
        $mode = :PrintAllSources
    when '--generate-xcfilelists'
        $mode = :GenerateXCFilelists
    when '--input-xcfilelist-path'
        $inputXCFilelistPath = arg
    when '--output-xcfilelist-path'
        $outputXCFilelistPath = arg
    when '--max-cpp-bundle-count'
        $maxCppBundleCount = arg.to_i
    when '--max-c-bundle-count'
        $maxCBundleCount = arg.to_i
    when '--max-obj-c-bundle-count'
        $maxObjCBundleCount = arg.to_i
    when '--max-bundle-size'
        $maxBundleSize = arg.to_i
    when '--dense-bundle-filter'
        $denseBundleFilters.push(arg)
    when '--bundle-filename-prefix'
        $bundleFilenamePrefix = arg
    end
}

$unifiedSourceOutputPath = $derivedSourcesPath + Pathname.new("unified-sources")
FileUtils.mkpath($unifiedSourceOutputPath) if !$unifiedSourceOutputPath.exist? && $mode != :GenerateXCFilelists

usage("--derived-sources-path must be specified.") if !$unifiedSourceOutputPath
usage("--source-tree-path must be specified.") if !$sourceTreePath
log("Putting unified sources in #{$unifiedSourceOutputPath}")

usage("At least one source list file must be specified.") if ARGV.length == 0
# Even though CMake will only pass us a single semicolon separated arguemnts, we separate all the arguments for simplicity.
sourceListFiles = ARGV.to_a.map { | sourceFileList | sourceFileList.split(";") }.flatten
log("Source files: #{sourceListFiles}")
$generatedSources = []
$inputSources = []
$outputSources = []

class SourceFile
    attr_reader :unifiable, :fileIndex, :path
    def initialize(file, fileIndex)
        @unifiable = true
        @fileIndex = fileIndex

        attributeStart = file =~ /@/
        if attributeStart
            # We want to make sure we skip the first @ so split works correctly
            attributesText = file[(attributeStart + 1)..file.length]
            attributesText.split(/\s*@/).each {
                | attribute |
                case attribute.strip
                when "no-unify"
                    @unifiable = false
                else
                    raise "unknown attribute: #{attribute}"
                end
            }
            file = file[0..(attributeStart-1)]
        end

        @path = Pathname.new(file.strip)
    end

    def <=>(other)
        return @path.dirname <=> other.path.dirname if @path.dirname != other.path.dirname
        return @path.basename <=> other.path.basename if @fileIndex == other.fileIndex
        @fileIndex <=> other.fileIndex
    end

    def derived?
        return @derived if @derived != nil
        @derived = !($sourceTreePath + self.path).exist?
    end

    def to_s
        if $mode == :GenerateXCFilelists
            if derived?
                ($derivedSourcesPath + @path).to_s
            else
                '$(SRCROOT)/' + @path.to_s
            end
        elsif $mode == :GenerateBundles || !derived?
            @path.to_s
        else
            ($derivedSourcesPath + @path).to_s
        end
    end
end

class BundleManager
    attr_reader :bundleCount, :extension, :fileCount, :currentBundleText, :maxCount, :extraFiles

    def initialize(extension, max)
        @extension = extension
        @fileCount = 0
        @bundleCount = 0
        @currentBundleText = ""
        @maxCount = max
        @extraFiles = []
        @currentDirectory = nil
        @lastBundlingPrefix = nil
    end

    def writeFile(file, text)
        bundleFile = $unifiedSourceOutputPath + file
        if $mode == :GenerateXCFilelists
            $outputSources << bundleFile
            return
        end
        if (!bundleFile.exist? || IO::read(bundleFile) != @currentBundleText)
            log("Writing bundle #{bundleFile} with: \n#{@currentBundleText}")
            IO::write(bundleFile, @currentBundleText)
        end
    end

    def bundleFileName()
        id =
            if @maxCount
                @bundleCount.to_s
            else
                # The dash makes the filenames more clear when using a hash.
                hash = Digest::SHA1.hexdigest(@currentDirectory.to_s)[0..7]
                "-#{hash}-#{@bundleCount}"
            end
        @extension == "cpp" ? "#{$bundleFilenamePrefix}UnifiedSource#{id}.#{extension}" : "#{$bundleFilenamePrefix}UnifiedSource#{id}-#{extension}.#{extension}"
    end

    def flush
        @bundleCount += 1
        bundleFile = bundleFileName
        $generatedSources << $unifiedSourceOutputPath + bundleFile
        @extraFiles << bundleFile if @maxCount and @bundleCount > @maxCount

        writeFile(bundleFile, @currentBundleText)
        @currentBundleText = ""
        @fileCount = 0
    end

    def flushToMax
        raise if !@maxCount
        while @bundleCount < @maxCount
            flush
        end
    end

    def addFile(sourceFile)
        path = sourceFile.path
        raise "wrong extension: #{path.extname} expected #{@extension}" unless path.extname == ".#{@extension}"
        bundlePrefix, bundleSize = BundlePrefixAndSizeForPath(path)
        if (@lastBundlingPrefix != bundlePrefix)
            unless @fileCount.zero?
                log("Flushing because new top level directory; old: #{@currentDirectory}, new: #{path.dirname}")
                flush
            end
            @lastBundlingPrefix = bundlePrefix
            @currentDirectory = path.dirname
            @bundleCount = 0 unless @maxCount
        end
        if @fileCount >= bundleSize
            log("Flushing because new bundle is full (#{@fileCount} sources)")
            flush
        end
        @currentBundleText += "#include \"#{sourceFile}\"\n"
        @fileCount += 1
    end
end

def BundlePrefixAndSizeForPath(path)
    topLevelDirectory = TopLevelDirectoryForPath(path.dirname)
    $denseBundleFilters.each { |filter|
        if path.fnmatch(filter)
            return filter, MAX_DENSE_BUNDLE_SIZE
        end
    }
    return topLevelDirectory, $maxBundleSize
end

def TopLevelDirectoryForPath(path)
    if !path
        return nil
    end
    while path.dirname != path.dirname.dirname
        path = path.dirname
    end
    return path
end

def ProcessFileForUnifiedSourceGeneration(sourceFile)
    path = sourceFile.path
    $inputSources << sourceFile.to_s

    bundle = $bundleManagers[path.extname]
    if !bundle
        log("No bundle for #{path.extname} files, building #{path} standalone")
        $generatedSources << sourceFile
    elsif !sourceFile.unifiable
        log("Not allowed to unify #{path}, building standalone")
        $generatedSources << sourceFile
    else
        bundle.addFile(sourceFile)
    end
end

$bundleManagers = {
    ".cpp" => BundleManager.new("cpp", $maxCppBundleCount),
    ".c" => BundleManager.new("c", $maxCBundleCount),
    ".mm" => BundleManager.new("mm", $maxObjCBundleCount)
}

seen = {}
sourceFiles = []

sourceListFiles.each_with_index {
    | path, sourceFileIndex |
    log("Reading #{path}")
    result = []
    File.read(path).lines.each {
        | line |
        commentStart = line =~ COMMENT_REGEXP
        log("Before: #{line}")
        if commentStart != nil
            line = line.slice(0, commentStart)
            log("After: #{line}")
        end
        line.strip!

        next if line.empty?

        if seen[line]
            next if $mode == :GenerateXCFilelists
            raise "duplicate line: #{line} in #{path}"
        end
        seen[line] = true
        result << SourceFile.new(line, sourceFileIndex)
    }

    log("Found #{result.length} source files in #{path}")
    sourceFiles += result
}

log("Found sources: #{sourceFiles.sort}")

sourceFiles.sort.each {
    | sourceFile |
    case $mode
    when :GenerateBundles, :GenerateXCFilelists
        ProcessFileForUnifiedSourceGeneration(sourceFile)
    when :PrintAllSources
        $generatedSources << sourceFile
    when :PrintBundledSources
        $generatedSources << sourceFile if $bundleManagers[sourceFile.path.extname] && sourceFile.unifiable
    end
}

if $mode != :PrintAllSources
    $bundleManagers.each_value {
        | manager |
        manager.flush unless manager.fileCount.zero?

        maxCount = manager.maxCount
        next if !maxCount # It is nil in CMake since maxCount limitation does not exist.

        manager.flushToMax

        unless manager.extraFiles.empty?
            extension = manager.extension
            bundleCount = manager.bundleCount
            filesToAdd = manager.extraFiles.join(", ")
            raise "number of bundles for #{extension} sources, #{bundleCount}, exceeded limit, #{maxCount}. Please add #{filesToAdd} to Xcode then update UnifiedSource#{extension.capitalize}FileCount"
        end
    }
end

if $mode == :GenerateXCFilelists
    IO::write($inputXCFilelistPath, $inputSources.sort.join("\n") + "\n") if $inputXCFilelistPath
    IO::write($outputXCFilelistPath, $outputSources.sort.join("\n") + "\n") if $outputXCFilelistPath
end

# We use stdout to report our unified source list to CMake.
# Add trailing semicolon and avoid a trailing newline for CMake's sake.

log($generatedSources.join(";") + ";")
print($generatedSources.join(";") + ";")
