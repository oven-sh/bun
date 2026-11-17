#import "bridge.h"
#import <PDFKit/PDFKit.h>

static NSMutableDictionary<NSNumber*, NSAlert*>* alerts;

static NSWindow* visibleWindow(BDMaybeu32 number)
{
    NSWindow* window = number.has ? [BunDesktopView withNumber:number.value].window : nil;
    return window.isVisible ? window : nil;
}

void pickFiles(const BDFilePicker* options, uint32_t replyNumber)
{
    NSOpenPanel* open = options->saves ? nil : NSOpenPanel.openPanel;
    NSSavePanel* panel = open ?: NSSavePanel.savePanel;
    open.canChooseFiles = options->takesFiles;
    open.canChooseDirectories = options->takesDirectories;
    open.allowsMultipleSelection = options->takesMany;
    open.resolvesAliases = !options->keepsAliases;
    panel.canCreateDirectories = options->createsDirectories;
    panel.showsHiddenFiles = options->showsHiddenFiles;
    panel.treatsFilePackagesAsDirectories = options->entersPackages;
    panel.title = stringIfAny(options->title) ?: panel.title;
    panel.message = stringIfAny(options->message) ?: panel.message;
    panel.prompt = stringIfAny(options->buttonLabel) ?: panel.prompt;
    if (stringIfAny(options->fileName))
        panel.nameFieldStringValue = string(options->fileName);
    if (stringIfAny(options->directory))
        panel.directoryURL = [NSURL fileURLWithPath:string(options->directory)];
    NSMutableArray* extensions = [NSMutableArray new];
    forEach(filter, options->filters) [extensions addObjectsFromArray:strings(filter->extensions)];
    [extensions removeObject:@""];
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    // Its successor does not know every extension.
    if (extensions.count && ![extensions containsObject:@"*"])
        panel.allowedFileTypes = extensions;
#pragma clang diagnostic pop
    NSWindow *parent = visibleWindow(options->window), *focused = parent ?: NSApp.keyWindow;
    void (^done)(NSModalResponse) = ^(NSModalResponse response) {
        giveFocusBack(focused);
        NSArray* urls = open ? open.URLs : panel.URL ? @[ panel.URL ] : @[];
        reply(replyNumber, BDReplyPaths, .paths = textsOf(response == NSModalResponseOK ? [urls valueForKey:@"path"] : nil));
    };
    whenIdle(^{
        if (parent)
            [panel beginSheetModalForWindow:parent completionHandler:done];
        else
            [panel beginWithCompletionHandler:done];
    });
}

void showMessage(const BDMessageBox* options, uint32_t replyNumber)
{
    NSAlert* alert = [NSAlert new];
    alert.alertStyle = options->isGrave ? NSAlertStyleCritical : NSAlertStyleInformational;
    alert.messageText = string(options->message);
    alert.informativeText = string(options->detail);
    forEach(label, options->buttons) {
        long index = label - options->buttons.start;
        NSButton* button = [alert addButtonWithTitle:stringIfAny(*label) ?: @"(empty)"];
        button.keyEquivalent = index == options->defaultButton ? @"\r" : index == options->cancelButton ? @"\x1b" : @"";
    }
    if (stringIfAny(options->checkboxLabel)) {
        alert.showsSuppressionButton = YES;
        alert.suppressionButton.title = string(options->checkboxLabel);
        alert.suppressionButton.state = options->isChecked;
    }
    NSNumber* identifier = @(options->id);
    alerts = alerts ?: [NSMutableDictionary new];
    alerts[identifier] = alert;
    NSWindow *parent = visibleWindow(options->window), *focused = parent ?: NSApp.keyWindow;
    void (^done)(NSModalResponse) = ^(NSModalResponse response) {
        giveFocusBack(focused);
        alerts[identifier] = nil;
        bool isChecked = alert.showsSuppressionButton && alert.suppressionButton.state;
        BDMaybeu32 index = { response >= NSAlertFirstButtonReturn, response - NSAlertFirstButtonReturn };
        reply(replyNumber, BDReplyButton, .button = { index, isChecked });
    };
    whenIdle(^{
        if (!alerts[identifier])
            done(NSModalResponseAbort);
        else if (parent)
            [alert beginSheetModalForWindow:parent completionHandler:done];
        else
            done([alert runModal]);
    });
}

void closeMessage(uint32_t identifier)
{
    NSWindow* window = alerts[@(identifier)].window;
    alerts[@(identifier)] = nil;
    if (window.sheetParent)
        [window.sheetParent endSheet:window returnCode:NSModalResponseAbort];
    else if (window.isVisible) {
        [NSApp stopModalWithCode:NSModalResponseAbort];
        postEmptyEvent();
    }
}

@interface BunDesktopPrinting : NSObject
@property (copy) void (^done)(BOOL);
@end

@implementation BunDesktopPrinting
- (void)operation:(NSPrintOperation*)operation didRun:(BOOL)success itself:(void*)itself
{
    self.done(success);
    CFRelease(itself);
}
@end

void print(const BDPrintJob* job, uint32_t replyNumber)
{
    PDFDocument* document = [[classIn(@"PDFKit", @"PDFDocument") alloc] initWithData:dataIfAny(job->pdf)];
    NSPrintInfo* info = [NSPrintInfo.sharedPrintInfo copy];
    NSPrinter* printer = stringIfAny(job->printer) ? [NSPrinter printerWithName:string(job->printer)] : info.printer;
    if (!document.pageCount || (job->isSilent && !printer))
        return reply(replyNumber, BDReplyAgreed, .agreed = false);
    info.printer = printer ?: info.printer;
    info.dictionary[NSPrintCopies] = @(job->copies);
    NSSize size = [[document pageAtIndex:0] boundsForBox:kPDFDisplayBoxMediaBox].size;
    info.orientation = size.width > size.height ? NSPaperOrientationLandscape : NSPaperOrientationPortrait;
    NSPrintOperation* operation = [document printOperationForPrintInfo:info scalingMode:kPDFPrintPageScaleDownToFit autoRotate:YES];
    operation.jobTitle = string(job->title);
    operation.showsPrintPanel = operation.showsProgressPanel = !job->isSilent;
    operation.printPanel.options |= NSPrintPanelShowsPaperSize | NSPrintPanelShowsOrientation | NSPrintPanelShowsScaling;
    NSWindow *parent = visibleWindow(job->window), *focused = parent ?: NSApp.keyWindow;
    BunDesktopPrinting* printing = [BunDesktopPrinting new];
    printing.done = ^(BOOL success) {
        (void)document;
        giveFocusBack(focused);
        reply(replyNumber, BDReplyAgreed, .agreed = success);
    };
    whenIdle(^{
        if (parent)
            [operation runOperationModalForWindow:parent delegate:printing didRunSelector:@selector(operation:didRun:itself:) contextInfo:(void*)CFBridgingRetain(printing)];
        else
            printing.done([operation runOperation]);
    });
}
